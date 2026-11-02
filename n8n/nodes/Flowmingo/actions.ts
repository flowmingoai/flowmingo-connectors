import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { flowmingoApiRequest, rowsOf } from './transport';

const PAGE_LIMIT = 100;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

type Operation = (this: IExecuteFunctions, i: number) => Promise<IDataObject | IDataObject[]>;

const param = <T>(ctx: IExecuteFunctions, name: string, i: number, fallback?: T): T =>
	ctx.getNodeParameter(name, i, fallback) as T;

const segment = (value: string) => encodeURIComponent(value.trim());

/** Drops empty optional values so they are left out instead of sent as "". */
const compact = (object: IDataObject): IDataObject =>
	Object.fromEntries(
		Object.entries(object).filter(
			([, value]) => value !== undefined && value !== null && value !== '',
		),
	);

const first = (list: unknown): IDataObject =>
	Array.isArray(list) && list.length ? (list[0] as IDataObject) : {};

const inviteErrors = (result: IDataObject): string[] => {
	const keyed = [
		'invitation_error_messages',
		'application_error_messages',
		'submission_error_messages',
	]
		.map((field) => result[field])
		.filter((value): value is IDataObject => !!value && typeof value === 'object')
		.flatMap((value) => Object.values(value));
	return [result.error_message, result.candidate_entry_error_message, ...keyed].filter(
		(message): message is string => typeof message === 'string' && message.length > 0,
	);
};

const inviteCandidate: Operation = async function (i) {
	const assessmentId = param<string>(this, 'assessmentId', i, '');
	const projectId = param<string>(this, 'projectId', i, '');
	const email = param<string>(this, 'email', i, '').trim();
	const extra = param<IDataObject>(this, 'additionalFields', i, {});
	if (!assessmentId && !projectId) {
		throw new NodeOperationError(this.getNode(), 'Pick an assessment, a hiring project, or both', {
			itemIndex: i,
		});
	}
	if (!email && !extra.cvLink) {
		throw new NodeOperationError(this.getNode(), 'Give the candidate an email or a CV link', {
			itemIndex: i,
		});
	}

	const body = compact({
		com_interview_set_ids: assessmentId ? [assessmentId] : undefined,
		com_project_ids: projectId ? [projectId] : undefined,
		com_job_post_ids: extra.jobPostId ? [extra.jobPostId as string] : undefined,
		candidates: [
			compact({
				email,
				firstname: extra.firstName,
				lastname: extra.lastName,
				cv_link: extra.cvLink,
			}),
		],
		invitation_message: extra.invitationMessage,
		send_invite: param<boolean>(this, 'sendInvite', i, true),
	});

	const response = await flowmingoApiRequest.call(this, 'POST', '/interview/candidate/invite/v1', {
		body,
		itemIndex: i,
	});
	const result = first(response.results);
	const invitation = first(result.invitations);
	const application = first(result.applications);
	const submission = first(result.submissions);
	const messages = inviteErrors(result);

	// A 201 can still refuse the candidate (docs §4.5): fail when nothing was created, report it otherwise.
	if (messages.length && !invitation.id && !application.id && !submission.id) {
		throw new NodeOperationError(this.getNode(), messages.join(' '), { itemIndex: i });
	}

	return {
		email: (result.email_address as string) ?? (email || null),
		tal_candidate_id:
			invitation.tal_candidate_id ??
			application.tal_candidate_id ??
			submission.tal_candidate_id ??
			null,
		invitation_id: invitation.id ?? null,
		invitation_status: invitation.status_text ?? null,
		application_id: application.id ?? null,
		submission_id: submission.id ?? null,
		submission_status: submission.status_text ?? null,
		warnings: messages.join(' ') || null,
	};
};

const findCandidateByEmail: Operation = async function (i) {
	const email = param<string>(this, 'email', i).trim();
	const response = await flowmingoApiRequest.call(this, 'GET', '/hiring/candidates/v1', {
		qs: { email, limit: 10 },
		itemIndex: i,
	});
	// The docs ask callers to compare the address before treating a row as a match (§5.6).
	return rowsOf(response).filter(
		(row) => typeof row.email === 'string' && row.email.toLowerCase() === email.toLowerCase(),
	);
};

const getCandidate: Operation = async function (i) {
	return flowmingoApiRequest.call(
		this,
		'GET',
		`/hiring/candidates/${segment(param(this, 'candidateId', i))}/v1`,
		{
			itemIndex: i,
		},
	);
};

const addApplication: Operation = async function (i) {
	const extra = param<IDataObject>(this, 'additionalFields', i, {});
	return flowmingoApiRequest.call(this, 'POST', '/hiring/applications/v1', {
		body: compact({
			tal_candidate_id: param<string>(this, 'candidateId', i).trim(),
			com_project_id: param<string>(this, 'projectId', i),
			com_job_post_id: extra.jobPostId,
			com_stage_id: extra.stageId,
		}),
		itemIndex: i,
	});
};

const moveStage: Operation = async function (i) {
	return flowmingoApiRequest.call(
		this,
		'POST',
		`/hiring/applications/${segment(param(this, 'applicationId', i))}/move-stage/v1`,
		{ body: { com_stage_id: param<string>(this, 'stageId', i) }, itemIndex: i },
	);
};

const rejectApplication: Operation = async function (i) {
	return flowmingoApiRequest.call(
		this,
		'POST',
		`/hiring/applications/${segment(param(this, 'applicationId', i))}/reject/v1`,
		{ itemIndex: i },
	);
};

const resultPath = (ctx: IExecuteFunctions, i: number, action: string) =>
	`/hiring/submissions/${segment(param(ctx, 'resultId', i))}/${action}`;

const getResult: Operation = async function (i) {
	return flowmingoApiRequest.call(this, 'GET', resultPath(this, i, 'detail/v1'), { itemIndex: i });
};

const addNote: Operation = async function (i) {
	const extra = param<IDataObject>(this, 'additionalFields', i, {});
	return flowmingoApiRequest.call(this, 'POST', resultPath(this, i, 'note/v1'), {
		body: compact({ note: param<string>(this, 'note', i), rating: extra.rating }),
		itemIndex: i,
	});
};

const rateResult: Operation = async function (i) {
	return flowmingoApiRequest.call(this, 'POST', resultPath(this, i, 'rate/v1'), {
		body: { rating: param<number>(this, 'rating', i) },
		itemIndex: i,
	});
};

const shortlistResult: Operation = async function (i) {
	return flowmingoApiRequest.call(this, 'POST', resultPath(this, i, 'shortlist/v1'), {
		body: { shortlisted: param<boolean>(this, 'shortlisted', i, true) },
		itemIndex: i,
	});
};

const createProject: Operation = async function (i) {
	const idempotencyKey = param<string>(this, 'idempotencyKey', i).trim();
	if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
		throw new NodeOperationError(
			this.getNode(),
			'Unique Key must be 8 to 128 characters from A-Z a-z 0-9 . _ : -',
			{
				itemIndex: i,
			},
		);
	}
	const extra = param<IDataObject>(this, 'additionalFields', i, {});
	// assessments: [] keeps the call to a few seconds; making them waits up to 45 s (docs §3.5.5).
	return flowmingoApiRequest.call(this, 'POST', '/hiring/projects/v1', {
		body: compact({
			title: param<string>(this, 'title', i),
			position: param<string>(this, 'position', i),
			description: extra.description,
			idempotency_key: idempotencyKey,
			assessments: [],
		}),
		itemIndex: i,
	});
};

const getManyProjects: Operation = async function (i) {
	const returnAll = param<boolean>(this, 'returnAll', i, false);
	const limit = returnAll ? Infinity : param<number>(this, 'limit', i, 50);
	const projects: IDataObject[] = [];
	for (let page = 1; projects.length < limit; page++) {
		const response = await flowmingoApiRequest.call(this, 'GET', '/hiring/projects/v1', {
			qs: { page, limit: PAGE_LIMIT },
			itemIndex: i,
		});
		const rows = rowsOf(response);
		projects.push(...rows);
		const total = Number(response.total);
		if (rows.length < PAGE_LIMIT || (Number.isFinite(total) && page * PAGE_LIMIT >= total)) break;
	}
	return projects.slice(0, limit);
};

export const operations: Record<string, Record<string, Operation>> = {
	application: { add: addApplication, moveStage, reject: rejectApplication },
	candidate: { findByEmail: findCandidateByEmail, get: getCandidate, invite: inviteCandidate },
	project: { create: createProject, getAll: getManyProjects },
	result: { addNote, get: getResult, rate: rateResult, shortlist: shortlistResult },
};
