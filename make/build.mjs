// Writes the Flowmingo custom app for Make into ./src, in the local-project layout of Make's VS Code extension
// ("Make Apps Editor": makecomapp.json + one folder per component). The trigger modules come from
// ../shared/contract.json, so a new event type there becomes a new Watch module here.
//
//   node build.mjs           regenerate ./src
//   node build.mjs --check   fail if ./src differs from what the contract and this file produce
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const SRC = join(ROOT, 'src')
const contract = JSON.parse(readFileSync(join(ROOT, '..', 'shared', 'contract.json'), 'utf8'))
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const USER_AGENT = `flowmingo-make/${VERSION}`
const CONNECTION = 'flowmingo'
const LIST_PAGE_SIZE = 100

// ── Labels ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const FIELD_LABELS = {
  event_id: 'Event ID',
  event_type: 'Event type',
  sub_event: 'Sub-event',
  timestamp: 'Recorded at',
  application_id: 'Application ID',
  com_project_id: 'Hiring project ID',
  com_job_post_id: 'Job post ID',
  com_stage_id: 'Stage ID',
  com_stage_from_id: 'Previous stage ID',
  tal_candidate_id: 'Candidate ID',
  candidate_id: 'Candidate ID',
  candidate_email: 'Candidate email',
  interview_set_id: 'Assessment ID',
  interview_name: 'Assessment name',
  submission_id: 'Result ID',
  submission_url: 'Result URL',
  invitation_id: 'Invitation ID',
  set_type: 'Assessment kind (number)',
  score_percent: 'Score (percent)',
  report_url: 'Report URL',
  is_practice: 'Practice run',
  activity_id: 'Activity ID'
}

const humanize = (key) =>
  FIELD_LABELS[key] ??
  key
    .split('_')
    .map((word) => ({ id: 'ID', url: 'URL', cv: 'CV' })[word] ?? word)
    .join(' ')
    .replace(/^./, (first) => first.toUpperCase())

const fieldType = (key, value) => {
  if (key === 'timestamp' || key.endsWith('_at')) return 'date'
  if (key.endsWith('_url')) return 'url'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'text'
}

// ── Base and connection ────────────────────────────────────────────────────────────────────────────────────────────

const ERROR_MESSAGE =
  "[{{statusCode}}] {{ifempty(body.message, 'Flowmingo returned an error.')}}{{if(body.code, ' (error code: ' + body.code + ')', '')}}"

const base = {
  baseUrl: contract.base_url,
  headers: { 'x-api-key': '{{connection.apiKey}}', 'user-agent': USER_AGENT },
  response: {
    error: {
      message: ERROR_MESSAGE,
      401: {
        type: 'InvalidAccessTokenError',
        message:
          '[401] Flowmingo did not accept the API key. It may have been revoked or disabled: reconnect with a valid key from Settings, API keys.'
      }
    }
  },
  log: { sanitize: ['request.headers.x-api-key'] }
}

const connection = {
  params: [
    {
      name: 'apiKey',
      type: 'password',
      label: 'API Key',
      required: true,
      editable: true,
      help:
        'Create a key in Flowmingo under **Settings > API keys**. It starts with `fl_`. Give it the scopes your scenarios need: `read_hiring` for the Watch modules and lists, `read_candidates` for names and emails, `invite_candidates` to invite, `write_pipeline` to move, reject and review, `create_project` to create projects. The Watch modules need a key created by an Owner or Admin.'
    }
  ],
  communication: {
    url: `${contract.base_url}${contract.auth.test.path}`,
    method: 'GET',
    headers: { 'x-api-key': '{{parameters.apiKey}}', 'user-agent': USER_AGENT },
    response: {
      metadata: { type: 'text', value: 'Organization {{body.organization_id}}' },
      error: { message: ERROR_MESSAGE }
    },
    log: { sanitize: ['request.headers.x-api-key'] }
  }
}

// ── RPCs (dropdowns) ───────────────────────────────────────────────────────────────────────────────────────────────

const pagedList = (path, label, extra = {}) => ({
  url: path,
  method: 'GET',
  qs: { limit: LIST_PAGE_SIZE, ...(extra.qs ?? {}) },
  response: {
    limit: 500,
    iterate: extra.iterate ?? '{{body.data}}',
    output: { label, value: '{{item.id}}' }
  },
  pagination: { qs: { page: '{{pagination.page}}' }, condition: `{{length(body.data) = ${LIST_PAGE_SIZE}}}` }
})

// IML has no "in" operator: one equality per kind, nested in if(); a set without a kind (older AI interviews) is kept.
const invitableCondition = Object.keys(contract.invitable_set_types).reduceRight(
  (otherwise, type) => `if(item.set_type = ${type}, true, ${otherwise})`,
  'false'
)
const rpcs = {
  listProjects: { label: 'List Hiring Projects', communication: pagedList('/hiring/projects/v1', '{{item.title}}') },
  listAssessments: {
    label: 'List Assessments',
    // Only the kinds the invite route can send: a Showcase, Recording or Questionnaire answers 400 there.
    communication: pagedList('/hiring/interview-sets/v1', '{{item.title}}', {
      iterate: {
        container: '{{body.data}}',
        condition: `{{if(item.set_type, ${invitableCondition}, true)}}`
      }
    })
  },
  listJobPosts: {
    label: 'List Job Posts',
    communication: pagedList('/hiring/job-posts/v1', '{{item.title}}', {
      qs: { com_project_id: '{{parameters.projectId}}' }
    })
  },
  listStages: {
    label: 'List Stages',
    // The stage list is not paged and answers an empty list for a project that is not yours.
    communication: {
      url: '/hiring/projects/{{parameters.projectId}}/stages/v1',
      method: 'GET',
      response: { iterate: '{{body.data}}', output: { label: '{{item.name}}', value: '{{item.id}}' } }
    }
  }
}

// ── Shared parameters ──────────────────────────────────────────────────────────────────────────────────────────────

const text = (name, label, extra = {}) => ({ name, type: 'text', label, ...extra })

const projectSelect = (nested, extra = {}) => ({
  name: 'projectId',
  type: 'select',
  label: 'Hiring Project',
  required: true,
  options: { store: 'rpc://listProjects', nested },
  ...extra
})
const stageSelect = (extra = {}) => ({ name: 'stageId', type: 'select', label: 'Stage', options: 'rpc://listStages', ...extra })
const jobPostSelect = (extra = {}) => ({
  name: 'jobPostId',
  type: 'select',
  label: 'Job Post',
  options: 'rpc://listJobPosts',
  ...extra
})
const resultId = text('resultId', 'Result ID', {
  required: true,
  help: 'The result (submission) ID, for example from **Watch AI Evaluations** or **Watch Completed Assessments**.'
})
const applicationId = text('applicationId', 'Application ID', {
  required: true,
  help: 'The application ID, for example from **Watch New Applications**.'
})
const limitParam = (label) => ({
  name: 'limit',
  type: 'uinteger',
  label: 'Limit',
  required: true,
  default: 10,
  help: `The maximum number of ${label} Make returns during one execution cycle.`
})

// ── Modules ────────────────────────────────────────────────────────────────────────────────────────────────────────

const TRIGGER_NAMES = {
  application_created: ['watchNewApplications', 'Watch New Applications', 'applications'],
  candidate_stage_changed: ['watchStageChanges', 'Watch Stage Changes', 'stage changes'],
  application_rejected: ['watchRejectedApplications', 'Watch Rejected Applications', 'rejected applications'],
  interview_status_updated: ['watchInterviewStatus', 'Watch Interview Status Changes', 'interview status changes'],
  interview_evaluated: ['watchEvaluations', 'Watch AI Evaluations', 'evaluations'],
  assessment_completed: ['watchCompletedAssessments', 'Watch Completed Assessments', 'completed assessments'],
  invitation_lifecycle_updated: ['watchInvitations', 'Watch Invitations', 'invitation updates'],
  invitation_email_status: ['watchInvitationEmails', 'Watch Invitation Emails', 'invitation email updates'],
  submission_reviewed: ['watchResultReviews', 'Watch Result Reviews', 'reviews']
}

const camel = (snake) => snake.replace(/_(.)/g, (_, letter) => letter.toUpperCase())

const triggerModule = (event) => {
  const names = TRIGGER_NAMES[event.key]
  if (!names) throw new Error(`No Watch module name for contract event ${event.key}: add it to TRIGGER_NAMES`)
  const [id, label, noun] = names
  const filterParam = event.sub_event_field ? camel(event.sub_event_field) : null
  const fields = { event_id: '', event_type: '', sub_event: '', timestamp: '', ...event.sample }
  const output = Object.fromEntries(
    Object.keys(fields).map((key) => [key, key in event.sample ? `{{item.data.${key}}}` : `{{item.${key}}}`])
  )

  return {
    id,
    group: 'Triggers',
    metadata: { label, description: event.description, moduleType: 'trigger' },
    staticParams: [
      limitParam(noun),
      ...(filterParam
        ? [
            {
              name: filterParam,
              type: 'select',
              label: filterParam === 'assessmentType' ? 'Assessment Type' : 'Only When',
              help: 'Leave empty to watch every kind.',
              options: Object.entries(event.sub_event_choices).map(([value, choice]) => ({ label: choice, value }))
            }
          ]
        : [])
    ],
    mappableParams: [],
    communication: {
      url: contract.events_feed.path,
      method: 'GET',
      qs: { event_type: event.event_type, limit: LIST_PAGE_SIZE },
      response: {
        limit: '{{parameters.limit}}',
        iterate: filterParam
          ? {
              container: '{{body.data}}',
              condition: `{{if(parameters.${filterParam}, item.data.${event.sub_event_field} = parameters.${filterParam}, true)}}`
            }
          : '{{body.data}}',
        trigger: { id: '{{item.event_id}}', date: '{{item.timestamp}}', type: 'date', order: 'desc' },
        output
      },
      pagination: { qs: { cursor: '{{body.next_cursor}}' }, condition: '{{body.next_cursor}}' }
    },
    interface: Object.entries(fields).map(([key, value]) => ({ name: key, label: humanize(key), type: fieldType(key, value) })),
    samples: {
      event_id: 'cca11cbd-00fd-4e16-ba60-75625ee9d196',
      event_type: event.event_type,
      sub_event: event.sub_event_field ? event.sample[event.sub_event_field] : null,
      timestamp: '2026-10-20T09:15:30.123Z',
      ...event.sample
    }
  }
}

const INVITE_OUTPUT = {
  email: '{{body.results[1].email_address}}',
  tal_candidate_id:
    '{{ifempty(body.results[1].invitations[1].tal_candidate_id, ifempty(body.results[1].applications[1].tal_candidate_id, body.results[1].submissions[1].tal_candidate_id))}}',
  invitation_id: '{{body.results[1].invitations[1].id}}',
  invitation_status: '{{body.results[1].invitations[1].status_text}}',
  application_id: '{{body.results[1].applications[1].id}}',
  submission_id: '{{body.results[1].submissions[1].id}}',
  submission_status: '{{body.results[1].submissions[1].status_text}}',
  invitation_error_messages: '{{body.results[1].invitation_error_messages}}',
  application_error_messages: '{{body.results[1].application_error_messages}}',
  submission_error_messages: '{{body.results[1].submission_error_messages}}'
}

const errorValues = (field) => `join(map(toArray(body.results[1].${field}), 'value'), ' ')`

const actionModules = [
  {
    id: 'inviteCandidate',
    group: 'Candidates',
    metadata: {
      label: 'Invite a Candidate',
      description: 'Adds a candidate and invites them to assessments, hiring projects, or both. Emails the invitation unless Send Invitation is off.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      {
        name: 'assessmentIds',
        type: 'select',
        multiple: true,
        label: 'Assessments',
        options: 'rpc://listAssessments',
        help: 'AI Interviews, Role-plays, CV Evaluations, Skill Tests or Technical Tests. A Skill Test or Technical Test must be the only assessment, and attached to the hiring project you pick. Pick assessments, hiring projects, or both.'
      },
      {
        name: 'projectIds',
        type: 'select',
        multiple: true,
        label: 'Hiring Projects',
        options: 'rpc://listProjects',
        help: 'Puts the candidate in these pipelines.'
      },
      jobPostSelect({ name: 'jobPostIds', multiple: true, label: 'Job Posts', help: 'The job posts the invitation is for.' }),
      { name: 'email', type: 'email', label: 'Email', help: 'Where the invitation goes. Required for a Skill Test or Technical Test. Without an email, the address is read from the CV.' },
      text('firstName', 'First Name'),
      text('lastName', 'Last Name'),
      { name: 'cvLink', type: 'url', label: 'CV Link', help: 'A public link to the CV. Required to order a CV Evaluation.' },
      text('invitationMessage', 'Invitation Message', { multiline: true, help: 'A note added to the invitation email, 10 to 5000 characters.' }),
      { name: 'sendInvite', type: 'boolean', label: 'Send Invitation', default: true, help: 'Turn off to add the candidate without emailing them.' }
    ],
    communication: {
      url: '/interview/candidate/invite/v1',
      method: 'POST',
      body: {
        com_interview_set_ids: '{{parameters.assessmentIds}}',
        com_project_ids: '{{parameters.projectIds}}',
        com_job_post_ids: '{{parameters.jobPostIds}}',
        candidates: [
          {
            email: '{{parameters.email}}',
            firstname: '{{parameters.firstName}}',
            lastname: '{{parameters.lastName}}',
            cv_link: '{{parameters.cvLink}}'
          }
        ],
        invitation_message: '{{parameters.invitationMessage}}',
        send_invite: '{{parameters.sendInvite}}'
      },
      response: {
        // A 201 can still refuse the candidate (docs §4.5): fail when nothing was created, return the messages otherwise.
        valid: {
          condition:
            '{{ifempty(body.results[1].invitations[1].id, ifempty(body.results[1].applications[1].id, body.results[1].submissions[1].id))}}',
          message: `{{ifempty(body.results[1].error_message, trim(${errorValues('invitation_error_messages')} + ' ' + ${errorValues('application_error_messages')} + ' ' + ${errorValues('submission_error_messages')}))}}`,
          type: 'DataError'
        },
        output: INVITE_OUTPUT
      }
    },
    interface: Object.keys(INVITE_OUTPUT).map((key) => ({
      name: key,
      label: key.endsWith('_messages') ? humanize(key.replace('_error_messages', '')) + ' warnings' : humanize(key),
      type: key.endsWith('_messages') ? 'collection' : 'text'
    })),
    samples: {
      email: 'alex@example.com',
      tal_candidate_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      invitation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      invitation_status: 'pending',
      application_id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      submission_id: '550e8400-e29b-41d4-a716-446655440000',
      submission_status: 'need_interview'
    }
  },
  {
    id: 'addCandidateToProject',
    group: 'Applications',
    metadata: {
      label: 'Add a Candidate to a Hiring Project',
      description: 'Puts a candidate already in your Flowmingo account into a hiring project.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      text('candidateId', 'Candidate ID', { required: true, help: 'A candidate already in your account. To bring in someone new, use **Invite a Candidate**.' }),
      projectSelect([
        jobPostSelect({ help: 'Needed when the project has more than one job post.' }),
        stageSelect({ help: 'Leave empty to start in the first stage.' })
      ])
    ],
    communication: {
      url: '/hiring/applications/v1',
      method: 'POST',
      body: {
        tal_candidate_id: '{{parameters.candidateId}}',
        com_project_id: '{{parameters.projectId}}',
        com_job_post_id: '{{parameters.jobPostId}}',
        com_stage_id: '{{parameters.stageId}}'
      },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Application ID', type: 'text' },
      { name: 'com_project_id', label: 'Hiring project ID', type: 'text' },
      { name: 'com_job_post_id', label: 'Job post ID', type: 'text' },
      { name: 'com_stage_id', label: 'Stage ID', type: 'text' },
      { name: 'status', label: 'Status', type: 'number' }
    ],
    samples: {
      id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      com_project_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      com_job_post_id: 'c0ffee00-dead-4bee-8f00-0123456789ab',
      com_stage_id: '5b8d1e92-3a7c-4c60-b2f4-91e6a0d7c358',
      status: 1
    }
  },
  {
    id: 'moveApplication',
    group: 'Applications',
    metadata: {
      label: 'Move an Application to a Stage',
      description: 'Moves an application to another stage of its hiring project. Emails the candidate if your team switched that on for the stage.',
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [
      applicationId,
      projectSelect([stageSelect({ required: true })], { help: "The application's own hiring project, to list its stages." })
    ],
    communication: {
      url: '/hiring/applications/{{encodeURL(parameters.applicationId)}}/move-stage/v1',
      method: 'POST',
      body: { com_stage_id: '{{parameters.stageId}}' },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Application ID', type: 'text' },
      { name: 'com_stage_id', label: 'Stage ID', type: 'text' }
    ],
    samples: { id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3', com_stage_id: '5b8d1e92-3a7c-4c60-b2f4-91e6a0d7c358' }
  },
  {
    id: 'rejectApplication',
    group: 'Applications',
    metadata: {
      label: 'Reject an Application',
      description: "Moves an application into its project's Rejected stage. Nothing is deleted. Emails the candidate if your team switched that on for the stage.",
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [applicationId],
    communication: {
      url: '/hiring/applications/{{encodeURL(parameters.applicationId)}}/reject/v1',
      method: 'POST',
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Application ID', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'com_stage_id', label: 'Rejected stage ID', type: 'text' }
    ],
    samples: { id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3', status: 'rejected', com_stage_id: '9e7a4d31-6b02-4f85-8c19-3a5d70e2b6c4' }
  },
  {
    id: 'addResultNote',
    group: 'Results',
    metadata: {
      label: 'Add a Note to a Result',
      description: 'Adds a note, and optionally a rating, to a result under the name of the person who created the API key.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      resultId,
      text('note', 'Note', { required: true, multiline: true, help: '1 to 2000 characters.' }),
      { name: 'rating', type: 'number', label: 'Rating', validate: { min: 0.5, max: 10 }, help: '0.5 to 10, in steps of 0.5.' }
    ],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.resultId)}}/note/v1',
      method: 'POST',
      body: { note: '{{parameters.note}}', rating: '{{parameters.rating}}' },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Note ID', type: 'text' },
      { name: 'note', label: 'Note', type: 'text' },
      { name: 'rating', label: 'Rating', type: 'number' },
      { name: 'created_at', label: 'Created at', type: 'date' }
    ],
    samples: { id: 'eca87aad-100e-4fe3-848e-83d55b07c78f', note: 'Strong systems thinking.', rating: 8, created_at: '2026-10-20T09:41:12.000Z' }
  },
  {
    id: 'rateResult',
    group: 'Results',
    metadata: {
      label: 'Rate a Result',
      description: 'Rates a result from 0 to 10, replacing the earlier rating by the same person.',
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [
      resultId,
      { name: 'rating', type: 'number', label: 'Rating', required: true, validate: { min: 0, max: 10 }, help: '0 to 10, in steps of 0.5.' }
    ],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.resultId)}}/rate/v1',
      method: 'POST',
      body: { rating: '{{parameters.rating}}' },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Rating ID', type: 'text' },
      { name: 'rating', label: 'Rating', type: 'number' },
      { name: 'rated_at', label: 'Rated at', type: 'date' }
    ],
    samples: { id: '7241c51b-23a7-4072-b345-5484cd0b54af', rating: 8, rated_at: '2026-10-20T09:42:03.000Z' }
  },
  {
    id: 'shortlistResult',
    group: 'Results',
    metadata: {
      label: 'Shortlist a Result',
      description: 'Shortlists a result, or removes the shortlist mark.',
      moduleType: 'action',
      actionCrud: 'update'
    },
    staticParams: [],
    mappableParams: [resultId, { name: 'shortlisted', type: 'boolean', label: 'Shortlisted', required: true, default: true }],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.resultId)}}/shortlist/v1',
      method: 'POST',
      body: { shortlisted: '{{parameters.shortlisted}}' },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Activity ID', type: 'text' },
      { name: 'shortlisted', label: 'Shortlisted', type: 'boolean' }
    ],
    samples: { id: 'b2cf0e3f-215b-483d-97f2-4078f18bf619', shortlisted: true }
  },
  {
    id: 'createProject',
    group: 'Hiring Projects',
    metadata: {
      label: 'Create a Hiring Project',
      description: 'Creates a hiring project with its four default stages and an AI-drafted job post. Assessments are added in Flowmingo afterwards.',
      moduleType: 'action',
      actionCrud: 'create'
    },
    staticParams: [],
    mappableParams: [
      text('title', 'Project Title', { required: true, help: 'How your team sees the project, up to 255 characters.' }),
      text('position', 'Position', { required: true, help: 'The role being hired for. It becomes the job post title.' }),
      text('description', 'Job Description', { multiline: true, help: 'The job description as text, up to 15000 characters. The job post is drafted from it.' }),
      text('idempotencyKey', 'Unique Key', {
        required: true,
        validate: { pattern: '^[A-Za-z0-9._:-]{8,128}$' },
        help: 'An ID of this job in your own system, 8 to 128 characters from A-Z a-z 0-9 . _ : -. Sending the same key again returns the same project instead of a second one.'
      })
    ],
    communication: {
      url: '/hiring/projects/v1',
      method: 'POST',
      // assessments: [] keeps the call to a few seconds; making them waits up to 45 s, past Make's 40 s module timeout.
      body: {
        title: '{{parameters.title}}',
        position: '{{parameters.position}}',
        description: '{{parameters.description}}',
        idempotency_key: '{{parameters.idempotencyKey}}',
        assessments: []
      },
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Hiring project ID', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'position', label: 'Position', type: 'text' },
      { name: 'status', label: 'Status', type: 'text' },
      { name: 'created_at', label: 'Created at', type: 'date' },
      {
        name: 'stages',
        label: 'Stages',
        type: 'array',
        spec: [
          { name: 'id', label: 'Stage ID', type: 'text' },
          { name: 'name', label: 'Name', type: 'text' }
        ]
      },
      {
        name: 'job_post',
        label: 'Job post',
        type: 'collection',
        spec: [
          { name: 'id', label: 'Job post ID', type: 'text' },
          { name: 'status', label: 'Status', type: 'text' }
        ]
      },
      { name: 'idempotent_replay', label: 'Returned an existing project', type: 'boolean' }
    ],
    samples: {
      id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      title: 'Support Engineer - Q4 hiring',
      position: 'Support Engineer',
      status: 'active',
      created_at: '2026-10-22T04:18:44.051Z',
      stages: [{ id: 'b0b0b0b0-abcd-4ef0-8123-456789abcdef', name: 'Unassigned' }],
      job_post: { id: 'c0ffee00-dead-4bee-8f00-0123456789ab', status: 'active' },
      idempotent_replay: false
    }
  }
]

const CANDIDATE_INTERFACE = [
  { name: 'id', label: 'Candidate ID', type: 'text' },
  { name: 'firstname', label: 'First name', type: 'text' },
  { name: 'lastname', label: 'Last name', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'cv_link', label: 'CV link', type: 'url' },
  { name: 'created_at', label: 'Created at', type: 'date' }
]
const CANDIDATE_SAMPLE = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  firstname: 'Alex',
  lastname: 'Kim',
  email: 'alex@example.com',
  cv_link: 'https://data.flowmingo.ai/cv/alex.pdf',
  created_at: '2026-10-19T08:30:00.000Z'
}

const readModules = [
  {
    id: 'searchCandidates',
    group: 'Candidates',
    metadata: { label: 'Search Candidates', description: 'Searches the candidates in your pipelines by email, or by name and CV text.', moduleType: 'search' },
    staticParams: [],
    mappableParams: [
      { name: 'email', type: 'email', label: 'Email', help: 'Matched exactly, ignoring capital letters.' },
      text('q', 'Search Text', { help: 'Matched against name, email and CV text, up to 120 characters. Used when Email is empty.' }),
      limitParam('candidates')
    ],
    communication: {
      url: '/hiring/candidates/v1',
      method: 'GET',
      qs: { email: '{{parameters.email}}', q: '{{if(parameters.email, undefined, parameters.q)}}', limit: LIST_PAGE_SIZE },
      response: {
        limit: '{{parameters.limit}}',
        // The docs ask callers to compare the address before treating a row as a match (§5.6).
        iterate: {
          container: '{{body.data}}',
          condition: '{{if(parameters.email, lower(item.email) = lower(parameters.email), true)}}'
        },
        output: '{{item}}'
      },
      pagination: { qs: { page: '{{pagination.page}}' }, condition: `{{length(body.data) = ${LIST_PAGE_SIZE}}}` }
    },
    interface: CANDIDATE_INTERFACE,
    samples: CANDIDATE_SAMPLE
  },
  {
    id: 'getCandidate',
    group: 'Candidates',
    metadata: { label: 'Get a Candidate', description: 'Gets one candidate by ID.', moduleType: 'action', actionCrud: 'read' },
    staticParams: [],
    mappableParams: [text('candidateId', 'Candidate ID', { required: true })],
    communication: {
      url: '/hiring/candidates/{{encodeURL(parameters.candidateId)}}/v1',
      method: 'GET',
      response: { output: '{{body}}' }
    },
    interface: [...CANDIDATE_INTERFACE, { name: 'phone', label: 'Phone', type: 'text' }, { name: 'thumb_cv_link', label: 'CV thumbnail link', type: 'url' }],
    samples: CANDIDATE_SAMPLE
  },
  {
    id: 'getResult',
    group: 'Results',
    metadata: {
      label: 'Get a Result',
      description: 'Gets one result with its AI evaluation: score, summary, strengths and gaps.',
      moduleType: 'action',
      actionCrud: 'read'
    },
    staticParams: [],
    mappableParams: [resultId],
    communication: {
      url: '/hiring/submissions/{{encodeURL(parameters.resultId)}}/detail/v1',
      method: 'GET',
      response: { output: '{{body}}' }
    },
    interface: [
      { name: 'id', label: 'Result ID', type: 'text' },
      { name: 'assessment_type', label: 'Assessment type', type: 'text' },
      { name: 'assessment_name', label: 'Assessment name', type: 'text' },
      { name: 'tal_candidate_id', label: 'Candidate ID', type: 'text' },
      { name: 'candidate_name', label: 'Candidate name', type: 'text' },
      { name: 'email', label: 'Candidate email', type: 'email' },
      { name: 'overall_score', label: 'Overall score (0-10)', type: 'number' },
      { name: 'score_status', label: 'Score status', type: 'text' },
      { name: 'submission_at', label: 'Submitted at', type: 'date' },
      {
        name: 'evaluation',
        label: 'Evaluation',
        type: 'collection',
        spec: [
          { name: 'summary', label: 'Summary', type: 'text' },
          { name: 'overall_rating', label: 'Overall rating', type: 'number' },
          { name: 'strengths', label: 'Strengths', type: 'array', spec: { type: 'text' } },
          { name: 'gaps', label: 'Gaps', type: 'array', spec: { type: 'text' } },
          { name: 'recommendations', label: 'Recommendations', type: 'array', spec: { type: 'text' } }
        ]
      }
    ],
    samples: {
      id: '59065d06-a013-44c2-97d2-88e9d6b3c858',
      assessment_type: 'ai_interview',
      assessment_name: 'AI Engineer - AI Interview',
      tal_candidate_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      candidate_name: 'Alex Kim',
      email: 'alex@example.com',
      overall_score: 7.2,
      score_status: 'scored',
      submission_at: '2026-09-10T12:00:49.000Z',
      evaluation: { summary: 'A strong applied engineer.', overall_rating: 7.2, strengths: ['Ships production RAG pipelines'], gaps: [], recommendations: [] }
    }
  },
  {
    id: 'listProjects',
    group: 'Hiring Projects',
    metadata: { label: 'List Hiring Projects', description: 'Lists your hiring projects, newest first.', moduleType: 'search' },
    staticParams: [],
    mappableParams: [limitParam('hiring projects')],
    communication: {
      url: '/hiring/projects/v1',
      method: 'GET',
      qs: { limit: LIST_PAGE_SIZE },
      response: { limit: '{{parameters.limit}}', iterate: '{{body.data}}', output: '{{item}}' },
      pagination: { qs: { page: '{{pagination.page}}' }, condition: `{{length(body.data) = ${LIST_PAGE_SIZE}}}` }
    },
    interface: [
      { name: 'id', label: 'Hiring project ID', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'created_at', label: 'Created at', type: 'date' },
      { name: 'candidates', label: 'Candidates in the pipeline', type: 'number' }
    ],
    samples: { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', title: 'Backend hiring, Q4', created_at: '2026-10-19T08:30:00.000Z', candidates: 56 }
  }
]

const keyValueArray = (name, label, extra = {}) => ({
  name,
  type: 'array',
  label,
  spec: [text('key', 'Key'), text('value', 'Value')],
  ...extra
})

const universalModule = {
  id: 'makeApiCall',
  group: 'Other',
  metadata: { label: 'Make an API Call', description: 'Performs an arbitrary authorized API call.', moduleType: 'universal' },
  staticParams: [],
  mappableParams: [
    text('url', 'URL', {
      required: true,
      help: `Enter a path relative to \`${contract.base_url}\`. For example: \`/hiring/projects/v1\`. The routes are listed at ${contract.auth.docs_url}.`
    }),
    {
      name: 'method',
      type: 'select',
      label: 'Method',
      required: true,
      default: 'GET',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({ label: method, value: method }))
    },
    keyValueArray('headers', 'Headers', {
      help: "You don't have to add the API key header; it is added for you.",
      default: [{ key: 'Content-Type', value: 'application/json' }]
    }),
    keyValueArray('qs', 'Query String'),
    { name: 'body', type: 'any', label: 'Body', help: 'Enter the body as JSON.' }
  ],
  communication: {
    url: '{{parameters.url}}',
    method: '{{parameters.method}}',
    headers: { '{{...}}': "{{toCollection(parameters.headers, 'key', 'value')}}" },
    qs: { '{{...}}': "{{toCollection(parameters.qs, 'key', 'value')}}" },
    body: '{{parameters.body}}',
    type: 'text',
    response: { output: { body: '{{body}}', headers: '{{headers}}', statusCode: '{{statusCode}}' } }
  },
  interface: [
    { name: 'body', label: 'Body', type: 'any' },
    { name: 'headers', label: 'Headers', type: 'collection' },
    { name: 'statusCode', label: 'Status code', type: 'number' }
  ],
  samples: { body: { data: [], total: 0, page: 1, limit: 20 }, headers: {}, statusCode: 200 }
}

const modules = [...contract.events.map(triggerModule), ...actionModules, ...readModules, universalModule]

const GROUP_ORDER = ['Triggers', 'Candidates', 'Applications', 'Results', 'Hiring Projects', 'Other']
const groups = GROUP_ORDER.map((label) => ({
  label,
  modules: modules.filter((module) => module.group === label).map((module) => module.id)
}))

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const kebab = (id) => id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
const files = new Map()
const put = (path, content) => files.set(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 4)}\n`)
const codeFile = (dir, id, code) => `${dir}/${id}/${kebab(id)}.${code}.iml.jsonc`

put('general/base.iml.jsonc', base)
put('modules/groups.json', groups)
put(codeFile('connections', CONNECTION, 'communication'), connection.communication)
put(codeFile('connections', CONNECTION, 'params'), connection.params)

const rpcComponents = {}
for (const [id, rpc] of Object.entries(rpcs)) {
  const codeFiles = { communication: codeFile('rpcs', id, 'communication'), params: codeFile('rpcs', id, 'params') }
  put(codeFiles.communication, rpc.communication)
  put(codeFiles.params, [])
  rpcComponents[id] = { label: rpc.label, connection: CONNECTION, codeFiles }
}

const moduleComponents = {}
for (const module of modules) {
  const codeFiles = {
    communication: codeFile('modules', module.id, 'communication'),
    staticParams: codeFile('modules', module.id, 'static-params'),
    mappableParams: codeFile('modules', module.id, 'mappable-params'),
    interface: codeFile('modules', module.id, 'interface'),
    samples: codeFile('modules', module.id, 'samples'),
    scope: codeFile('modules', module.id, 'scope')
  }
  if (module.metadata.moduleType === 'trigger') codeFiles.epoch = null
  put(codeFiles.communication, module.communication)
  put(codeFiles.staticParams, module.staticParams)
  put(codeFiles.mappableParams, module.mappableParams)
  put(codeFiles.interface, module.interface)
  put(codeFiles.samples, module.samples)
  put(codeFiles.scope, [])
  moduleComponents[module.id] = { ...module.metadata, connection: CONNECTION, codeFiles }
}

put('README.md', readFileSync(join(ROOT, 'APP-README.md'), 'utf8'))

put('makecomapp.json', {
  fileVersion: 1,
  generalCodeFiles: { base: 'general/base.iml.jsonc', common: null, readme: 'README.md', groups: 'modules/groups.json' },
  components: {
    connection: {
      [CONNECTION]: {
        label: 'Flowmingo',
        connectionType: 'basic',
        codeFiles: {
          communication: codeFile('connections', CONNECTION, 'communication'),
          params: codeFile('connections', CONNECTION, 'params'),
          common: null
        }
      }
    },
    webhook: {},
    module: moduleComponents,
    rpc: rpcComponents,
    function: {},
    endpoint: {}
  },
  // Filled in when the app is first deployed from Make's VS Code extension (the app id comes from Make).
  origins: []
})

// ── Write or check ─────────────────────────────────────────────────────────────────────────────────────────────────

const listFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [relative(SRC, path)]
  })

if (process.argv.includes('--check')) {
  const existing = new Set(listFiles(SRC))
  const problems = []
  for (const [path, content] of files) {
    if (!existing.has(path)) problems.push(`missing ${path}`)
    else if (readFileSync(join(SRC, path), 'utf8') !== content) problems.push(`differs ${path}`)
    existing.delete(path)
  }
  for (const path of existing) problems.push(`not generated ${path}`)
  if (problems.length) {
    console.error(`src/ is out of date (run node build.mjs):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`src/ is up to date (${files.size} files)`)
} else {
  rmSync(SRC, { recursive: true, force: true })
  for (const [path, content] of files) {
    mkdirSync(dirname(join(SRC, path)), { recursive: true })
    writeFileSync(join(SRC, path), content)
  }
  console.log(`wrote ${files.size} files to src/ (${modules.length} modules, ${Object.keys(rpcs).length} RPCs)`)
}
