import {browserHistory, InjectedRouter} from 'react-router';
import {Location} from 'history';
import {Organization} from 'static/app/types/organization';
import {Project} from 'static/app/types/project';

import {initializeOrg} from 'sentry-test/initializeOrg';
import {act, render, screen, waitFor} from 'sentry-test/reactTestingLibrary';

import CommitterStore from 'sentry/stores/committerStore';
import {Event, Group} from 'sentry/types';
import GroupEventDetails, {
  GroupEventDetailsProps,
} from 'sentry/views/organizationGroupDetails/groupEventDetails/groupEventDetails';

const makeDefaultMockData = (
  organization?: Organization,
  project?: Project
): {
  event: Event;
  group: Group;
  organization: Organization;
  project: Project;
  router: InjectedRouter;
} => {
  return {
    organization: organization ?? initializeOrg().organization,
    project: project ?? initializeOrg().project,
    group: TestStubs.Group(),
    router: TestStubs.router({}),
    event: TestStubs.Event({
      size: 1,
      dateCreated: '2019-03-20T00:00:00.000Z',
      errors: [],
      entries: [],
      tags: [{key: 'environment', value: 'dev'}],
    }),
  };
};

const TestComponent = (props: Partial<GroupEventDetailsProps>) => {
  const {organization, project, group, event, router} = makeDefaultMockData(
    props.organization,
    props.project
  );

  return (
    <GroupEventDetails
      api={new MockApiClient()}
      group={group}
      event={event}
      project={project}
      organization={organization}
      environments={[{id: '1', name: 'dev', displayName: 'Dev'}]}
      params={{orgId: organization.slug, groupId: group.id, eventId: '1'}}
      router={router}
      location={{} as Location<any>}
      route={{}}
      routes={[]}
      routeParams={{}}
      {...props}
    />
  );
};

const mockGroupApis = (
  organization: Organization,
  project: Project,
  group: Group,
  event: Event
) => {
  MockApiClient.addMockResponse({
    url: `/issues/${group.id}/`,
    body: group,
  });

  MockApiClient.addMockResponse({
    url: `/projects/${organization.slug}/${project.slug}/issues/`,
    method: 'PUT',
  });

  MockApiClient.addMockResponse({
    url: `/projects/${organization.slug}/${project.slug}/events/${event.id}/committers/`,
    body: {committers: []},
  });

  MockApiClient.addMockResponse({
    url: `/projects/${organization.slug}/${project.slug}/releases/completion/`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/projects/${organization.slug}/${project.slug}/events/${event.id}/owners/`,
    body: {owners: [], rules: []},
  });

  MockApiClient.addMockResponse({
    url: `/issues/${group.id}/participants/`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/issues/${group.id}/tags/`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/groups/${group.id}/integrations/`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/groups/${group.id}/external-issues/`,
  });

  MockApiClient.addMockResponse({
    url: `/issues/${group.id}/current-release/`,
    body: {currentRelease: null},
  });

  MockApiClient.addMockResponse({
    url: '/prompts-activity/',
    body: undefined,
  });

  MockApiClient.addMockResponse({
    url: `/organizations/${organization.slug}/has-mobile-app-events/`,
    body: null,
  });

  MockApiClient.addMockResponse({
    url: `/projects/${organization.slug}/${project.slug}/events/${event.id}/grouping-info/`,
    body: {},
  });
  MockApiClient.addMockResponse({
    url: `/projects/${organization.slug}/${project.slug}/codeowners/`,
    body: [],
  });
  MockApiClient.addMockResponse({
    url: `/organizations/${organization.slug}/code-mappings/`,
    method: 'GET',
    body: [],
  });

  // Sentry related mocks
  MockApiClient.addMockResponse({
    url: '/sentry-apps/',
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/organizations/${organization.slug}/sentry-apps/`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/organizations/${organization.slug}/sentry-app-installations/`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: `/organizations/${organization.slug}/sentry-app-components/?projectId=${project.id}`,
    body: [],
  });

  MockApiClient.addMockResponse({
    url: '/projects/org-slug/project-slug/',
    body: project,
  });
};

describe('groupEventDetails', () => {
  beforeEach(() => {
    MockApiClient.clearMockResponses();
    CommitterStore.init();
  });

  afterEach(function () {
    MockApiClient.clearMockResponses();
    CommitterStore.teardown();
    (browserHistory.replace as jest.Mock).mockClear();
  });

  it('redirects on switching to an invalid environment selection for event', async function () {
    const props = makeDefaultMockData();
    mockGroupApis(props.organization, props.project, props.group, props.event);

    const {rerender} = render(<TestComponent {...props} />);
    expect(browserHistory.replace).not.toHaveBeenCalled();

    rerender(
      <TestComponent environments={[{id: '1', name: 'prod', displayName: 'Prod'}]} />
    );

    await waitFor(() => expect(browserHistory.replace).toHaveBeenCalled());
  });

  it('does not redirect when switching to a valid environment selection for event', async function () {
    const props = makeDefaultMockData();
    mockGroupApis(props.organization, props.project, props.group, props.event);

    const {rerender} = render(<TestComponent {...props} />);

    expect(browserHistory.replace).not.toHaveBeenCalled();
    rerender(<TestComponent environments={[]} />);

    await act(async () => {
      await tick();
    });

    expect(browserHistory.replace).not.toHaveBeenCalled();
  });

  it('next/prev links', async function () {
    const props = makeDefaultMockData();

    mockGroupApis(
      props.organization,
      props.project,
      props.group,
      TestStubs.Event({
        size: 1,
        dateCreated: '2019-03-20T00:00:00.000Z',
        errors: [],
        entries: [],
        tags: [{key: 'environment', value: 'dev'}],
        previousEventID: 'prev-event-id',
        nextEventID: 'next-event-id',
      })
    );

    MockApiClient.addMockResponse({
      url: `/projects/${props.organization.slug}/${props.project.slug}/events/1/`,
      body: event,
    });

    const routerContext = TestStubs.routerContext();

    render(
      <TestComponent
        {...props}
        location={{query: {environment: 'dev'}} as Location<any>}
      />,
      {
        context: routerContext,
      }
    );

    expect(screen.getByLabelText(/Oldest/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Older/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Newer/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Newest/)).toBeInTheDocument();
  });

  it('displays error on event error', async function () {
    const props = makeDefaultMockData();

    mockGroupApis(
      props.organization,
      props.project,
      props.group,
      TestStubs.Event({
        size: 1,
        dateCreated: '2019-03-20T00:00:00.000Z',
        errors: [],
        entries: [],
        tags: [{key: 'environment', value: 'dev'}],
        previousEventID: 'prev-event-id',
        nextEventID: 'next-event-id',
      })
    );

    render(
      <TestComponent
        api={new MockApiClient()}
        group={props.group}
        event={undefined}
        eventError
        project={props.project}
        organization={props.organization}
        environments={[{id: '1', name: 'dev', displayName: 'Dev'}]}
        params={{orgId: props.organization.slug, groupId: props.group.id, eventId: '1'}}
        location={{} as Location<any>}
      />
    );

    expect(
      await screen.findByText(/events for this issue could not be found/)
    ).toBeInTheDocument();
  });
});

describe('EventCauseEmpty', () => {
  beforeEach(() => {
    MockApiClient.clearMockResponses();
    CommitterStore.init();
  });

  afterEach(function () {
    MockApiClient.clearMockResponses();
    (browserHistory.replace as jest.Mock).mockClear();
    CommitterStore.teardown();
  });

  it('renders empty state', async function () {
    const props = makeDefaultMockData(
      undefined,
      TestStubs.Project({firstEvent: TestStubs.Event()})
    );

    mockGroupApis(
      props.organization,
      props.project,
      props.group,
      TestStubs.Event({
        size: 1,
        dateCreated: '2019-03-20T00:00:00.000Z',
        errors: [],
        entries: [],
        tags: [{key: 'environment', value: 'dev'}],
        previousEventID: 'prev-event-id',
        nextEventID: 'next-event-id',
      })
    );

    MockApiClient.addMockResponse({
      url: `/projects/${props.organization.slug}/${props.project.slug}/releases/completion/`,
      body: [
        {
          step: 'commit',
          complete: false,
        },
      ],
    });

    render(
      <TestComponent
        api={new MockApiClient()}
        group={props.group}
        event={props.event}
        project={props.project}
        organization={props.organization}
        environments={[{id: '1', name: 'dev', displayName: 'Dev'}]}
        params={{orgId: props.organization.slug, groupId: props.group.id, eventId: '1'}}
        location={{} as Location<any>}
      />
    );

    expect(await screen.findByTestId(/loaded-event-cause-empty/)).toBeInTheDocument();
    expect(screen.queryByText(/event-cause/)).not.toBeInTheDocument();
  });

  it('renders suspect commit', async function () {
    const props = makeDefaultMockData(
      undefined,
      TestStubs.Project({firstEvent: TestStubs.Event()})
    );

    mockGroupApis(
      props.organization,
      props.project,
      props.group,
      TestStubs.Event({
        size: 1,
        dateCreated: '2019-03-20T00:00:00.000Z',
        errors: [],
        entries: [],
        tags: [{key: 'environment', value: 'dev'}],
        previousEventID: 'prev-event-id',
        nextEventID: 'next-event-id',
      })
    );

    MockApiClient.addMockResponse({
      url: `/projects/${props.organization.slug}/${props.project.slug}/releases/completion/`,
      body: [
        {
          step: 'commit',
          complete: true,
        },
      ],
    });

    CommitterStore.loadSuccess(
      props.organization.slug,
      props.project.slug,
      props.event.id,
      [
        {
          commits: [TestStubs.Commit({author: TestStubs.CommitAuthor()})],
          author: TestStubs.CommitAuthor(),
        },
      ]
    );

    render(
      <TestComponent
        api={new MockApiClient()}
        group={props.group}
        event={props.event}
        project={props.project}
        organization={props.organization}
        environments={[{id: '1', name: 'dev', displayName: 'Dev'}]}
        params={{
          orgId: props.organization.slug,
          groupId: props.group.id,
          eventId: '1',
        }}
        location={{} as Location<any>}
      />
    );

    expect(await screen.findByTestId(/event-cause/)).toBeInTheDocument();
    expect(screen.queryByTestId(/loaded-event-cause-empty/)).not.toBeInTheDocument();
  });

  it('renders suspect commit if `releasesCompletion` empty', async function () {
    const props = makeDefaultMockData(
      undefined,
      TestStubs.Project({firstEvent: TestStubs.Event()})
    );

    mockGroupApis(
      props.organization,
      props.project,
      props.group,
      TestStubs.Event({
        size: 1,
        dateCreated: '2019-03-20T00:00:00.000Z',
        errors: [],
        entries: [],
        tags: [{key: 'environment', value: 'dev'}],
        previousEventID: 'prev-event-id',
        nextEventID: 'next-event-id',
      })
    );

    MockApiClient.addMockResponse({
      url: `/projects/${props.organization.slug}/${props.project.slug}/releases/completion/`,
      body: [],
    });

    render(
      <TestComponent
        api={new MockApiClient()}
        group={props.group}
        event={props.event}
        project={props.project}
        organization={props.organization}
        environments={[{id: '1', name: 'dev', displayName: 'Dev'}]}
        params={{orgId: props.organization.slug, groupId: props.group.id, eventId: '1'}}
        location={{} as Location<any>}
      />
    );

    expect(screen.queryByTestId(/loaded-event-cause-empty/)).not.toBeInTheDocument();
  });
});

describe('Platform Integrations', () => {
  let componentsRequest;

  beforeEach(() => {
    MockApiClient.clearMockResponses();
  });

  it('loads Integration UI components', () => {
    const props = makeDefaultMockData();

    const unpublishedIntegration = TestStubs.SentryApp({status: 'unpublished'});
    const internalIntegration = TestStubs.SentryApp({status: 'internal'});

    const unpublishedInstall = TestStubs.SentryAppInstallation({
      app: {
        slug: unpublishedIntegration.slug,
        uuid: unpublishedIntegration.uuid,
      },
    });

    const internalInstall = TestStubs.SentryAppInstallation({
      app: {
        slug: internalIntegration.slug,
        uuid: internalIntegration.uuid,
      },
    });

    mockGroupApis(
      props.organization,
      props.project,
      props.group,
      TestStubs.Event({
        size: 1,
        dateCreated: '2019-03-20T00:00:00.000Z',
        errors: [],
        entries: [],
        tags: [{key: 'environment', value: 'dev'}],
        previousEventID: 'prev-event-id',
        nextEventID: 'next-event-id',
      })
    );

    const component = TestStubs.SentryAppComponent({
      sentryApp: {
        uuid: unpublishedIntegration.uuid,
        slug: unpublishedIntegration.slug,
        name: unpublishedIntegration.name,
      },
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${props.organization.slug}/sentry-app-installations/`,
      body: [unpublishedInstall, internalInstall],
    });

    componentsRequest = MockApiClient.addMockResponse({
      url: `/organizations/${props.organization.slug}/sentry-app-components/?projectId=${props.project.id}`,
      body: [component],
    });

    render(
      <TestComponent
        api={new MockApiClient()}
        group={props.group}
        event={props.event}
        project={props.project}
        organization={props.organization}
        environments={[{id: '1', name: 'dev', displayName: 'Dev'}]}
        params={{orgId: props.organization.slug, groupId: props.group.id, eventId: '1'}}
        location={{} as Location<any>}
      />
    );

    expect(componentsRequest).toHaveBeenCalled();
  });
});