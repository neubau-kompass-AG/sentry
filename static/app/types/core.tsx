/**
 * Basic types that are required to build types in other type modules.
 *
 * Before a type is put here it should be required in multiple other types.
 * or used in multiple views.
 */
import {API_ACCESS_SCOPES} from 'sentry/constants';

/**
 * Visual representation of a project/team/organization/user
 */
export type Avatar = {
  avatarUuid: string | null;
  avatarType: 'letter_avatar' | 'upload' | 'gravatar' | 'background';
};

export type ObjectStatus =
  | 'active'
  | 'disabled'
  | 'pending_deletion'
  | 'deletion_in_progress';

export type Actor = {
  type: 'user' | 'team';
  id: string;
  name: string;
  email?: string;
};

export type Scope = typeof API_ACCESS_SCOPES[number];

/**
 * Simple timeseries data used in groups, projects and release health.
 */
export type TimeseriesValue = [timestamp: number, value: number];

// taken from https://stackoverflow.com/questions/46634876/how-can-i-change-a-readonly-property-in-typescript
export type Writable<T> = {-readonly [K in keyof T]: T[K]};