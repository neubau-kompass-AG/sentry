from __future__ import annotations

import logging
import uuid

from django.http.response import HttpResponse
from django.urls import resolve
from rest_framework.request import Request
from rest_framework.response import Response

from sentry.ratelimits import (
    above_rate_limit_check,
    finish_request,
    get_rate_limit_key,
    get_rate_limit_value,
)
from sentry.ratelimits.config import ENFORCE_CONCURRENT_RATE_LIMITS
from sentry.types.ratelimit import RateLimitCategory, RateLimitType

DEFAULT_ERROR_MESSAGE = (
    "You are attempting to use this endpoint too frequently. Limit is "
    "{limit} requests in {window} seconds"
)


class RatelimitMiddleware:
    """Middleware that applies a rate limit to every endpoint.
    See: https://docs.djangoproject.com/en/4.0/topics/http/middleware/#writing-your-own-middleware
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: Request) -> Response:
        rate_limit_metadata = None
        rate_limit_key = None
        rate_limit_uid = None

        # First, check if the endpoint call will violate.
        try:
            request.rate_limit_category = None
            # CEO: idk how to not put this on the request object
            # and still have it in the access logs and test for it
            rate_limit_uid = uuid.uuid4().hex
            view_func = resolve(request.path).func
            rate_limit_key = get_rate_limit_key(view_func, request)
            if rate_limit_key is None:
                return
            category_str = rate_limit_key.split(":", 1)[0]
            request.rate_limit_category = category_str

            rate_limit = get_rate_limit_value(
                http_method=request.method,
                endpoint=view_func.view_class,
                category=RateLimitCategory(category_str),
            )
            if rate_limit is None:
                return

            rate_limit_metadata = above_rate_limit_check(rate_limit_key, rate_limit, rate_limit_uid)
            # TODO: also limit by concurrent window once we have the data
            rate_limit_cond = (
                rate_limit_metadata.rate_limit_type != RateLimitType.NOT_LIMITED
                if ENFORCE_CONCURRENT_RATE_LIMITS
                else rate_limit_metadata.rate_limit_type == RateLimitType.FIXED_WINDOW
            )
            if rate_limit_cond:
                enforce_rate_limit = getattr(view_func.view_class, "enforce_rate_limit", False)
                if enforce_rate_limit:
                    response = HttpResponse(
                        {
                            "detail": DEFAULT_ERROR_MESSAGE.format(
                                limit=rate_limit_metadata.limit,
                                window=rate_limit_metadata.window,
                            )
                        },
                        status=429,
                    )
                    self.add_headers(response, rate_limit_metadata)
                    return response

        except Exception:
            logging.exception("Error during rate limiting, failing open. THIS SHOULD NOT HAPPEN")

        # Hit the endpoint
        response = self.get_response(request)

        # Process the response
        self.add_headers(response, rate_limit_metadata)
        finish_request(rate_limit_key, rate_limit_uid)
        return response

    def add_headers(self, response, rate_limit_metadata=None):
        if not rate_limit_metadata:
            logging.exception("COULD NOT POPULATE RATE LIMIT HEADERS")
            return response

        response["X-Sentry-Rate-Limit-Remaining"] = rate_limit_metadata.remaining
        response["X-Sentry-Rate-Limit-Limit"] = rate_limit_metadata.limit
        response["X-Sentry-Rate-Limit-Reset"] = rate_limit_metadata.reset_time
        response[
            "X-Sentry-Rate-Limit-ConcurrentRemaining"
        ] = rate_limit_metadata.concurrent_remaining
        response["X-Sentry-Rate-Limit-ConcurrentLimit"] = rate_limit_metadata.concurrent_limit
        return response
