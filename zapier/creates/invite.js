'use strict'

const { url } = require('../lib/http')
const { toBoolean, compact, projectField, jobPostField } = require('../lib/fields')

const errorMessages = (result) => {
  const keyed = ['invitation_error_messages', 'application_error_messages', 'submission_error_messages']
    .map((field) => result[field])
    .filter((value) => value && typeof value === 'object')
    .flatMap((value) => Object.values(value))
  return [result.error_message, result.candidate_entry_error_message, ...keyed].filter(
    (message) => typeof message === 'string' && message
  )
}

const first = (list) => (Array.isArray(list) && list.length ? list[0] : {})

// What was created but will not go out as things stand (an invitation to a draft assessment is not emailed).
const warningMessages = (result) =>
  (Array.isArray(result.warnings) ? result.warnings : [])
    .map((warning) => warning && warning.message)
    .filter((message) => typeof message === 'string' && message)

const perform = async (z, bundle) => {
  const input = bundle.inputData
  if (!input.com_interview_set_id && !input.com_project_id) {
    throw new z.errors.Error('Pick an assessment, a hiring project, or both.', 'invalid_input', 400)
  }
  if (!input.email && !input.cv_link) {
    throw new z.errors.Error('Give the candidate an email or a CV link.', 'invalid_input', 400)
  }

  const body = compact({
    com_interview_set_ids: input.com_interview_set_id ? [input.com_interview_set_id] : undefined,
    com_project_ids: input.com_project_id ? [input.com_project_id] : undefined,
    com_job_post_ids: input.com_job_post_id ? [input.com_job_post_id] : undefined,
    candidates: [compact({ email: input.email, firstname: input.firstname, lastname: input.lastname, cv_link: input.cv_link })],
    invitation_message: input.invitation_message,
    send_invite: toBoolean(input.send_invite, true)
  })

  const response = await z.request({ url: url('/interview/candidate/invite/v1'), method: 'POST', body })
  const result = first(response.data && response.data.results)
  const invitation = first(result.invitations)
  const application = first(result.applications)
  const submission = first(result.submissions)
  const messages = errorMessages(result)

  // A 201 can still refuse the candidate (docs §4.5): fail the step when nothing was created, report it otherwise.
  if (messages.length && !invitation.id && !application.id && !submission.id) {
    throw new z.errors.Error(messages.join(' '), 'invite_refused', 400)
  }

  return {
    email: result.email_address ?? input.email ?? null,
    tal_candidate_id: invitation.tal_candidate_id ?? application.tal_candidate_id ?? submission.tal_candidate_id ?? null,
    invitation_id: invitation.id ?? null,
    invitation_status: invitation.status_text ?? null,
    application_id: application.id ?? null,
    submission_id: submission.id ?? null,
    submission_status: submission.status_text ?? null,
    warnings: [...messages, ...warningMessages(result)].join(' ') || null
  }
}

module.exports = {
  key: 'invite_candidate',
  noun: 'Invitation',
  display: {
    label: 'Invite Candidate',
    description:
      'Adds a candidate and invites them to an assessment, a hiring project, or both. Emails the invitation unless you turn Send Invitation off.'
  },
  operation: {
    inputFields: [
      {
        key: 'com_interview_set_id',
        label: 'Assessment',
        dynamic: 'assessment_list.id.label',
        required: false,
        helpText:
          'An AI Interview, Role-play, CV Evaluation, Skill Test or Technical Test. A Skill Test or Technical Test must also be attached to the hiring project you pick.'
      },
      projectField({ required: false, helpText: 'Puts the candidate in this pipeline.' }),
      jobPostField(),
      { key: 'email', label: 'Email', required: false, helpText: 'Where the invitation goes. Required for a Skill Test or Technical Test.' },
      { key: 'firstname', label: 'First Name', required: false },
      { key: 'lastname', label: 'Last Name', required: false },
      {
        key: 'cv_link',
        label: 'CV Link',
        required: false,
        helpText: 'A public link to the CV. Required to order a CV Evaluation. Without an email, the address is read from the CV.'
      },
      {
        key: 'invitation_message',
        label: 'Invitation Message',
        type: 'text',
        required: false,
        helpText: 'A note added to the email, 10 to 5000 characters.'
      },
      {
        key: 'send_invite',
        label: 'Send Invitation',
        type: 'boolean',
        default: 'true',
        required: false,
        helpText: 'Turn off to add the candidate without emailing them.'
      }
    ],
    perform,
    sample: {
      email: 'alex@example.com',
      tal_candidate_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      invitation_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      invitation_status: 'pending',
      application_id: '2d1c0f6a-8b3e-4f57-9a62-7c41d5e0b8f3',
      submission_id: '550e8400-e29b-41d4-a716-446655440000',
      submission_status: 'need_interview',
      warnings: null
    }
  }
}
