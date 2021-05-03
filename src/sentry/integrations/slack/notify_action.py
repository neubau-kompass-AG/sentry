from __future__ import absolute_import

from django import forms
from django.utils.translation import ugettext_lazy as _

from sentry import http
from sentry.rules.actions.base import EventAction
from sentry.utils import metrics, json
from sentry.models import Integration

from .utils import build_attachment

MEMBER_PREFIX = '@'
CHANNEL_PREFIX = '#'
strip_channel_chars = ''.join([MEMBER_PREFIX, CHANNEL_PREFIX])



class SlackNotifyServiceForm(forms.Form):
    workspace = forms.ChoiceField(choices=(), widget=forms.Select(
    ))
    channel = forms.CharField(widget=forms.TextInput())
    channel_id = forms.HiddenInput()
    tags = forms.CharField(required=False, widget=forms.TextInput())

    def __init__(self, *args, **kwargs):
        # NOTE: Workspace maps directly to the integration ID
        workspace_list = [(i.id, i.name) for i in kwargs.pop('integrations')]
        self.channel_transformer = kwargs.pop('channel_transformer')

        super(SlackNotifyServiceForm, self).__init__(*args, **kwargs)

        if workspace_list:
            self.fields['workspace'].initial = workspace_list[0][0]

        self.fields['workspace'].choices = workspace_list
        self.fields['workspace'].widget.choices = self.fields['workspace'].choices

    def clean(self):
        cleaned_data = super(SlackNotifyServiceForm, self).clean()

        workspace = cleaned_data.get('workspace')
        channel = cleaned_data.get('channel', '').lstrip(strip_channel_chars)

        channel_prefix, channel_id, timed_out = self.channel_transformer(workspace, channel)

        channel = channel.lstrip(strip_channel_chars);

        if channel_id is None and timed_out:
            cleaned_data['channel'] = channel_prefix + channel
            cleaned_data['channel_id'] = channel_id
            return cleaned_data

        if channel_id is None and workspace is not None:
            params = {
                "channel": channel,
                "workspace": dict(self.fields["workspace"].choices).get(int(workspace)),
            }

            raise forms.ValidationError(
                _(
                    'The slack resource "%(channel)s" does not exist or has not been granted access in the %(workspace)s Slack workspace.'
                ),
                code="invalid",
                params=params,
            )

        cleaned_data['channel'] = channel_prefix + channel
        cleaned_data['channel_id'] = channel_id

        return cleaned_data


class SlackNotifyServiceAction(EventAction):
    form_cls = SlackNotifyServiceForm
    label = u'Send a notification to the {workspace} Slack workspace to {channel} and show tags {tags} in notification'

    def __init__(self, *args, **kwargs):
        super(SlackNotifyServiceAction, self).__init__(*args, **kwargs)
        self.form_fields = {
            'workspace': {
                'type': 'choice',
                'choices': [(i.id, i.name) for i in self.get_integrations()]
            },
            'channel': {
                'type': 'string',
                'placeholder': 'i.e #critical'
            },
            'tags': {
                'type': 'string',
                'placeholder': 'i.e environment,user,my_tag'
            }
        }

    def is_enabled(self):
        return self.get_integrations().exists()

    def after(self, event, state):
        if event.group.is_ignored():
            return

        integration_id = self.get_option('workspace')
        channel = self.get_option('channel_id')
        tags = set(self.get_tags_list())

        try:
            integration = Integration.objects.get(
                provider='slack',
                organizations=self.project.organization,
                id=integration_id
            )
        except Integration.DoesNotExist:
            # Integration removed, rule still active.
            return

        def send_notification(event, futures):
            rules = [f.rule for f in futures]
            attachment = build_attachment(event.group, event=event, tags=tags, rules=rules)

            payload = {
                'token': integration.metadata['access_token'],
                'channel': channel,
                'attachments': json.dumps([attachment]),
            }

            session = http.build_session()
            resp = session.post('https://slack.com/api/chat.postMessage', data=payload)
            resp.raise_for_status()
            resp = resp.json()
            if not resp.get('ok'):
                self.logger.info('rule.fail.slack_post', extra={'error': resp.get('error')})

        key = u'slack:{}:{}'.format(integration_id, channel)

        metrics.incr('notifications.sent', instance='slack.notification', skip_internal=False)
        yield self.future(send_notification, key=key)

    def render_label(self):
        try:
            integration_name = Integration.objects.get(
                provider='slack',
                organizations=self.project.organization,
                id=self.get_option('workspace')
            ).name
        except Integration.DoesNotExist:
            integration_name = '[removed]'

        tags = self.get_tags_list()

        return self.label.format(
            workspace=integration_name,
            channel=self.get_option('channel'),
            tags=u'[{}]'.format(', '.join(tags)),
        )

    def get_tags_list(self):
        return [s.strip() for s in self.get_option('tags', '').split(',')]

    def get_integrations(self):
        return Integration.objects.filter(
            provider='slack',
            organizations=self.project.organization,
        )

    def get_form_instance(self):
        return self.form_cls(
            self.data,
            integrations=self.get_integrations(),
            channel_transformer=self.get_channel_id,
        )

    def get_channel_id(self, integration_id, name):
        try:
            integration = Integration.objects.get(
                provider='slack',
                organizations=self.project.organization,
                id=integration_id,
            )
        except Integration.DoesNotExist:
            return None

        session = http.build_session()

        headers = {"Authorization": "Bearer %s" % integration.metadata['access_token']}

        # Look for channel ID
        payload = {
            "exclude_archived": False,
            "exclude_members": True,
            "types": "public_channel,private_channel",
        }

        # Different list types in slack that we'll use to resolve a channel name. Format is
        # (<list_name>, <result_name>, <prefix>).
        list_types = [
            ("conversations", "channels", CHANNEL_PREFIX),
            ("users", "members", MEMBER_PREFIX),
        ]

        id_data = None
        found_duplicate = False
        prefix = ""

        for list_type, result_name, prefix in list_types:
            cursor = ""
            while True:
                endpoint = "https://slack.com/api/%s.list" % list_type
                # Slack limits the response of `<list_type>.list` to 1000 channels
                resp = session.get(
                    endpoint, headers=headers, params=dict(payload, cursor=cursor, limit=1000)
                )
                resp = resp.json()

                if not resp.get('ok'):
                    self.logger.info('rule.slack.%s_list_failed' % list_type, extra={'error': resp.get('error')})
                    return (prefix, None, False)


                for c in resp[result_name]:
                    # The "name" field is unique (this is the username for users)
                    # so we return immediately if we find a match.
                    # convert to lower case since all names in Slack are lowercase
                    if c["name"].lower() == name.lower():
                        return (prefix, c["id"], False)
                    # If we don't get a match on a unique identifier, we look through
                    # the users' display names, and error if there is a repeat.
                    if list_type == "users":
                        profile = c.get("profile")
                        if profile and profile.get("display_name") == name:
                            if id_data:
                                found_duplicate = True
                            else:
                                id_data = (prefix, c["id"], False)

                cursor = resp.get("response_metadata", {}).get("next_cursor", None)
                if time.time() > time_to_quit:
                    return (prefix, None, True)

                if not cursor:
                    break
            if found_duplicate:
                raise DuplicateDisplayNameError(name)
            elif id_data:
                return id_data

        return (prefix, None, False)
