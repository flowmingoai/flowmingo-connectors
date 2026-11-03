'use strict';

const fs = require('fs');
const path = require('path');
const { NodeApiError } = require('n8n-workflow');

const { Flowmingo } = require('../dist/nodes/Flowmingo/Flowmingo.node');
const { FlowmingoTrigger } = require('../dist/nodes/FlowmingoTrigger/FlowmingoTrigger.node');
const { FlowmingoApi } = require('../dist/credentials/FlowmingoApi.credentials');
const { CONNECTOR_VERSION } = require('../dist/nodes/Flowmingo/transport');

const BASE = 'https://apis.flowmingo.ai/company/integration';
const ok = (body, statusCode = 200) => ({ statusCode, body });
const NODE = {
	id: 'n1',
	name: 'Flowmingo',
	type: 'n8n-nodes-flowmingo.flowmingo',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/** A stand-in for n8n's execution context: parameters by name, queued HTTP answers, recorded requests. */
const context = ({ params = {}, responses = [], mode = 'trigger', staticData = {}, continueOnFail = false, items }) => {
	const calls = [];
	const read = (name, fallback) => {
		if (params[name] !== undefined) return params[name];
		if (fallback !== undefined) return fallback;
		throw new Error(`Parameter ${name} was read but not set`);
	};
	// Like n8n, `extractValue` turns a "From list / By ID" value ({ __rl, mode, value }) into its value.
	const extract = (value, options) =>
		options?.extractValue && value && typeof value === 'object' && value.__rl ? value.value : value;
	const ctx = {
		getInputData: () => items ?? [{ json: {} }],
		// IExecuteFunctions passes (name, itemIndex, fallback, options); IPollFunctions passes (name, fallback, options).
		getNodeParameter: (name, second, third, fourth) =>
			mode === 'poll' ? extract(read(name, second), third) : extract(read(name, third), fourth),
		getCurrentNodeParameter: (name, options) => extract(params[name], options),
		getNode: () => NODE,
		continueOnFail: () => continueOnFail,
		getMode: () => (mode === 'poll' ? 'trigger' : mode),
		getWorkflowStaticData: () => staticData,
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ credential, ...options });
				if (!responses.length) throw new Error(`Unexpected request ${options.method} ${options.url}`);
				return responses.shift();
			},
		},
	};
	return { ctx, calls };
};

const picked = (value, mode = 'list') => ({ __rl: true, mode, value });

const execute = (params, responses, extra = {}) => {
	const { ctx, calls } = context({ params, responses, mode: 'manual', ...extra });
	return new Flowmingo().execute.call(ctx).then((output) => ({ output: output[0], calls }));
};

describe('package', () => {
	it('should send the package version as the connector version', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
		expect(CONNECTOR_VERSION).toBe(pkg.version);
	});

	it('should bundle a contract identical to shared/contract.json', () => {
		const shared = fs.readFileSync(path.join(__dirname, '../../shared/contract.json'), 'utf8');
		const bundled = fs.readFileSync(path.join(__dirname, '../nodes/Flowmingo/contract.json'), 'utf8');
		expect(bundled).toBe(shared);
	});

	it('should authenticate with the x-api-key header and test the key on /me/v1', () => {
		const credential = new FlowmingoApi();
		expect(credential.authenticate.properties.headers).toEqual({ 'x-api-key': '={{$credentials.apiKey}}' });
		expect(credential.test.request).toMatchObject({ baseURL: BASE, url: '/me/v1', method: 'GET' });
		expect(credential.test.rules).toEqual([
			{ type: 'responseCode', properties: { value: 401, message: expect.stringMatching(/did not accept this API key/) } },
		]);
		expect(credential.properties[0].typeOptions.password).toBe(true);
	});
});

describe('Flowmingo node: candidate', () => {
	it('should invite with arrays and a real boolean, and flatten the answer', async () => {
		const { output, calls } = await execute(
			{
				resource: 'candidate',
				operation: 'invite',
				assessmentId: picked('i1'),
				projectId: picked(' p1 ', 'id'),
				email: ' alex@example.com ',
				sendInvite: false,
				additionalFields: { firstName: 'Alex', jobPostId: 'j1' },
			},
			[
				ok(
					{
						results: [
							{
								email_address: 'alex@example.com',
								invitations: [{ id: 'inv1', tal_candidate_id: 'c1', status_text: 'pending' }],
								applications: [{ id: 'app1' }],
								submissions: [{ id: 'sub1', status_text: 'need_interview' }],
							},
						],
					},
					201,
				),
			],
		);

		expect(calls[0]).toMatchObject({
			credential: 'flowmingoApi',
			method: 'POST',
			url: `${BASE}/interview/candidate/invite/v1`,
			body: {
				com_interview_set_ids: ['i1'],
				com_project_ids: ['p1'],
				com_job_post_ids: ['j1'],
				candidates: [{ email: 'alex@example.com', firstname: 'Alex' }],
				send_invite: false,
			},
		});
		expect(calls[0].headers['user-agent']).toBe(`n8n-nodes-flowmingo/${CONNECTOR_VERSION}`);
		expect(output[0]).toEqual({
			json: {
				email: 'alex@example.com',
				tal_candidate_id: 'c1',
				invitation_id: 'inv1',
				invitation_status: 'pending',
				application_id: 'app1',
				submission_id: 'sub1',
				submission_status: 'need_interview',
				warnings: null,
			},
			pairedItem: { item: 0 },
		});
	});

	it('should fail when a 201 created nothing for the candidate', async () => {
		await expect(
			execute(
				{ resource: 'candidate', operation: 'invite', assessmentId: 'i1', email: 'a@b.co', additionalFields: {} },
				[ok({ results: [{ invitation_error_messages: { i1: 'Email already invited' } }] }, 201)],
			),
		).rejects.toThrow(/Email already invited/);
	});

	it('should keep a partial refusal as a warning', async () => {
		const { output } = await execute(
			{ resource: 'candidate', operation: 'invite', projectId: 'p1', email: 'a@b.co', additionalFields: {} },
			[
				ok(
					{
						results: [
							{
								applications: [{ id: 'app1' }],
								submission_error_messages: { x: 'Not created' },
							},
						],
					},
					201,
				),
			],
		);
		expect(output[0].json.warnings).toBe('Not created');
	});

	it("should pass on the API's warning that an invitation to a draft will not be emailed, without failing", async () => {
		const message = 'Assessment "Sales" is a draft, so this invitation is not emailed: it is sent once it is published in Flowmingo.';
		const { output } = await execute(
			{ resource: 'candidate', operation: 'invite', assessmentId: 'i1', email: 'a@b.co', additionalFields: {} },
			[
				ok(
					{
						results: [
							{
								invitations: [{ id: 'inv1', status_text: 'pending' }],
								warnings: [{ code: 'assessment_not_active', com_interview_set_id: 'i1', message }],
							},
						],
					},
					201,
				),
			],
		);
		expect(output[0].json.invitation_id).toBe('inv1');
		expect(output[0].json.warnings).toBe(message);
	});

	it('should refuse an invite without an assessment or a project before calling the API', async () => {
		const run = execute(
			{
				resource: 'candidate',
				operation: 'invite',
				assessmentId: picked(''),
				projectId: picked(''),
				email: 'a@b.co',
				additionalFields: {},
			},
			[],
		);
		await expect(run).rejects.toThrow(/assessment, a hiring project, or both/);
	});

	it('should return only rows whose email matches, ignoring case', async () => {
		const { output, calls } = await execute({ resource: 'candidate', operation: 'findByEmail', email: 'Alex@Example.com' }, [
			ok({ data: [{ id: 'c1', email: 'alex@example.com' }, { id: 'c2', email: 'x@example.com' }], total: 2 }),
		]);
		expect(calls[0].qs).toEqual({ email: 'Alex@Example.com', limit: 10 });
		expect(output.map((item) => item.json.id)).toEqual(['c1']);
	});
});

describe('Flowmingo node: application and result', () => {
	it('should move an application with an encoded id and the stage only', async () => {
		const { calls } = await execute(
			{ resource: 'application', operation: 'moveStage', applicationId: ' app/1 ', projectId: 'p1', stageId: 's2' },
			[ok({ id: 'app/1', com_stage_id: 's2' }, 201)],
		);
		expect(calls[0]).toMatchObject({
			url: `${BASE}/hiring/applications/app%2F1/move-stage/v1`,
			body: { com_stage_id: 's2' },
		});
	});

	it('should add an application without empty optional fields', async () => {
		const { calls } = await execute(
			{
				resource: 'application',
				operation: 'add',
				candidateId: 'c1',
				projectId: picked('p1'),
				additionalFields: { jobPostId: '', stageId: 's1' },
			},
			[ok({ id: 'app1' }, 201)],
		);
		expect(calls[0].body).toEqual({ tal_candidate_id: 'c1', com_project_id: 'p1', com_stage_id: 's1' });
	});

	it('should rate with a JSON number and add a note without a rating', async () => {
		const rated = await execute({ resource: 'result', operation: 'rate', resultId: 's1', rating: 7.5 }, [
			ok({ id: 'r1', rating: 7.5 }, 201),
		]);
		expect(rated.calls[0].body).toEqual({ rating: 7.5 });

		const noted = await execute(
			{ resource: 'result', operation: 'addNote', resultId: 's1', note: 'Strong answers.', additionalFields: {} },
			[ok({ id: 'n1' }, 201)],
		);
		expect(noted.calls[0]).toMatchObject({ url: `${BASE}/hiring/submissions/s1/note/v1`, body: { note: 'Strong answers.' } });
	});

	it('should surface the API message and status as a NodeApiError', async () => {
		const run = execute({ resource: 'result', operation: 'get', resultId: 's9' }, [
			{ statusCode: 404, body: { statusCode: 404, message: 'Submission not found' } },
		]);
		await expect(run).rejects.toBeInstanceOf(NodeApiError);
		await expect(
			execute({ resource: 'result', operation: 'get', resultId: 's9' }, [
				{ statusCode: 404, body: { statusCode: 404, message: 'Submission not found' } },
			]),
		).rejects.toMatchObject({ httpCode: '404', message: 'Submission not found' });
	});

	it('should tell the user to update the credential when the key is refused', async () => {
		await expect(
			execute({ resource: 'project', operation: 'getAll', returnAll: false, limit: 1 }, [
				{ statusCode: 401, body: { statusCode: 401, message: 'Invalid API key' } },
			]),
		).rejects.toMatchObject({ httpCode: '401', message: expect.stringMatching(/did not accept the API key \(Invalid API key\).*Settings > API keys/) });
	});

	it('should return an error item instead of failing when Continue On Fail is on', async () => {
		const { output } = await execute(
			{ resource: 'application', operation: 'reject', applicationId: 'a1' },
			[{ statusCode: 400, body: { statusCode: 400, message: 'Project has no Rejected stage' } }],
			{ continueOnFail: true },
		);
		expect(output[0]).toEqual({ json: { error: 'Project has no Rejected stage' }, pairedItem: { item: 0 } });
	});
});

describe('Flowmingo node: project', () => {
	it('should create the project alone with the caller key', async () => {
		const { calls } = await execute(
			{
				resource: 'project',
				operation: 'create',
				title: 'Support Q4',
				position: 'Support Engineer',
				idempotencyKey: 'ats-job-48213',
				additionalFields: {},
			},
			[ok({ id: 'p1' }, 201)],
		);
		expect(calls[0].body).toEqual({
			title: 'Support Q4',
			position: 'Support Engineer',
			idempotency_key: 'ats-job-48213',
			assessments: [],
		});
	});

	it('should refuse a malformed unique key before calling the API', async () => {
		const run = execute(
			{ resource: 'project', operation: 'create', title: 'T', position: 'P', idempotencyKey: 'short', additionalFields: {} },
			[],
		);
		await expect(run).rejects.toThrow(/Unique Key/);
	});

	it('should page until the limit is reached', async () => {
		const page = (from, count) => Array.from({ length: count }, (_, n) => ({ id: `p${from + n}` }));
		const { output, calls } = await execute({ resource: 'project', operation: 'getAll', returnAll: false, limit: 150 }, [
			ok({ data: page(0, 100), total: 300 }),
			ok({ data: page(100, 100), total: 300 }),
		]);
		expect(calls.map((call) => call.qs.page)).toEqual([1, 2]);
		expect(output).toHaveLength(150);
	});
});

describe('Flowmingo node: dropdowns', () => {
	it('should list only assessments the invite route can send', async () => {
		const { ctx } = context({
			responses: [
				ok({
					data: [
						{ id: 'i1', title: 'Sales', set_type: 1 },
						{ id: 'i2', title: 'Portfolio', set_type: 4 },
						{ id: 'i3', title: 'Legacy', set_type: null },
					],
				}),
			],
		});
		const options = await new Flowmingo().methods.listSearch.searchAssessments.call(ctx);
		expect(options).toEqual({
			results: [
				{ name: 'Sales (AI Interview)', value: 'i1' },
				{ name: 'Legacy', value: 'i3' },
			],
		});
	});

	it("should label a draft, inactive or archived assessment, whose invitation is not emailed", async () => {
		const { ctx } = context({
			responses: [
				ok({
					data: [
						{ id: 'i1', title: 'Sales', set_type: 1, status: 1 },
						{ id: 'i2', title: 'Sales v2', set_type: 7, status: 2 },
						{ id: 'i3', title: 'Old', set_type: 1, status: 3 },
						{ id: 'i4', title: 'Paused', set_type: 1, status: 0 },
						{ id: 'i5', title: 'Legacy draft', set_type: null, status: 2 },
					],
				}),
			],
		});
		const options = await new Flowmingo().methods.listSearch.searchAssessments.call(ctx);
		expect(options.results.map((option) => option.name)).toEqual([
			'Sales (AI Interview)',
			'Sales v2 (Role-play, Draft)',
			'Old (AI Interview, Archived)',
			'Paused (AI Interview, Inactive)',
			'Legacy draft (Draft)',
		]);
	});

	it('should search projects by name, ignoring case', async () => {
		const { ctx } = context({
			responses: [
				ok({
					data: [
						{ id: 'p1', title: 'Amazon PPC Specialist' },
						{ id: 'p2', title: 'Backend Engineer' },
					],
				}),
			],
		});
		const found = await new Flowmingo().methods.listSearch.searchProjects.call(ctx, ' ppc ');
		expect(found).toEqual({ results: [{ name: 'Amazon PPC Specialist', value: 'p1' }] });
	});

	it('should list no stages until a project is picked', async () => {
		const { ctx, calls } = context({ params: { projectId: picked('') } });
		expect(await new Flowmingo().methods.loadOptions.getStages.call(ctx)).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it('should list the stages of the picked project', async () => {
		const { ctx, calls } = context({
			params: { projectId: picked('p1') },
			responses: [ok({ data: [{ id: 's1', name: 'Shortlisted' }] })],
		});
		expect(await new Flowmingo().methods.loadOptions.getStages.call(ctx)).toEqual([
			{ name: 'Shortlisted', value: 's1' },
		]);
		expect(calls[0].url).toBe(`${BASE}/hiring/projects/p1/stages/v1`);
	});

	// n8n can load a dropdown before it has attached the credential to a node just added, and does not retry.
	it('should load no dropdown as the node opens', () => {
		const opensLoaded = new Flowmingo().description.properties.filter(
			(property) =>
				property.type === 'options' &&
				property.typeOptions?.loadOptionsMethod &&
				!property.typeOptions.loadOptionsDependsOn?.length,
		);
		expect(opensLoaded.map((property) => property.name)).toEqual([]);
	});
});

describe('Flowmingo Trigger', () => {
	const feed = (events, nextCursor = null) => ok({ data: events, next_cursor: nextCursor });
	const event = (id, data = {}) => ({
		event_id: id,
		event_type: 'assessment.completed',
		sub_event: data.assessment_type ?? null,
		timestamp: '2026-10-20T09:15:30.123Z',
		data,
	});
	const poll = (params, responses, staticData, mode = 'poll') => {
		const { ctx, calls } = context({ params, responses, staticData, mode });
		return new FlowmingoTrigger().poll.call(ctx).then((output) => ({ output, calls }));
	};
	const params = { event: 'assessment.completed', filter_assessment_completed: '' };

	it('should only record where the feed stands on the first poll', async () => {
		const state = {};
		const { output, calls } = await poll(params, [feed([event('e2'), event('e1')], 'older')], state);

		expect(output).toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0].qs).toEqual({ event_type: 'assessment.completed', limit: 100 });
		expect(state.seenIds).toEqual(['e2', 'e1']);
	});

	it('should emit new events oldest first and stop at the first page holding a seen one', async () => {
		const state = { seenIds: ['e2', 'e1'] };
		const { output, calls } = await poll(params, [feed([event('e4'), event('e3'), event('e2')], 'older')], state);

		expect(calls).toHaveLength(1);
		expect(output[0].map((item) => item.json.event_id)).toEqual(['e3', 'e4']);
		expect(state.seenIds.slice(0, 4)).toEqual(['e4', 'e3', 'e2', 'e1']);
	});

	it('should read older pages while every event on a page is new', async () => {
		const state = { seenIds: ['e1'] };
		const { output, calls } = await poll(
			params,
			[feed([event('e3')], 'c1'), feed([event('e2'), event('e1')], 'c2')],
			state,
		);

		expect(calls[1].qs.cursor).toBe('c1');
		expect(output[0].map((item) => item.json.event_id)).toEqual(['e2', 'e3']);
	});

	it('should apply the filter but still remember the events it skipped', async () => {
		const state = { seenIds: ['e1'] };
		const { output } = await poll(
			{ ...params, filter_assessment_completed: 'skill_test' },
			[feed([event('e3', { assessment_type: 'showcase' }), event('e2', { assessment_type: 'skill_test' }), event('e1')])],
			state,
		);

		expect(output[0].map((item) => item.json.event_id)).toEqual(['e2']);
		expect(state.seenIds).toContain('e3');
	});

	it('should show the newest matching event in a manual test without touching the state', async () => {
		const state = { seenIds: ['e1'] };
		const { output } = await poll(params, [feed([event('e5', { score: 8.7 }), event('e1')])], state, 'manual');

		expect(output[0][0].json).toMatchObject({ event_id: 'e5', score: 8.7, event_type: 'assessment.completed' });
		expect(state.seenIds).toEqual(['e1']);
	});

	it('should return nothing when no new event arrived', async () => {
		const { output } = await poll(params, [feed([event('e1')])], { seenIds: ['e1'] });
		expect(output).toBeNull();
	});
});
