import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import contract from './contract.json';
import { flowmingoApiRequest, rowsOf } from './transport';

const PAGE_LIMIT = 100;
// A dropdown reads at most this many pages, so a large account cannot turn one click into hundreds of requests.
const MAX_PAGES = 5;

const invitableSetTypes: Record<string, string> = contract.invitable_set_types;

async function listAll(
	this: ILoadOptionsFunctions,
	path: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const response = await flowmingoApiRequest.call(this, 'GET', path, {
			qs: { ...qs, page, limit: PAGE_LIMIT },
		});
		const batch = rowsOf(response);
		rows.push(...batch);
		if (batch.length < PAGE_LIMIT) break;
	}
	return rows;
}

const currentProjectId = (ctx: ILoadOptionsFunctions): string => {
	const value = ctx.getCurrentNodeParameter('projectId');
	return typeof value === 'string' ? value : '';
};

export async function getProjects(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const rows = await listAll.call(this, '/hiring/projects/v1');
	return rows.map((row) => ({ name: String(row.title), value: String(row.id) }));
}

/** Only the kinds the invite route can send: a Showcase, Recording or Questionnaire answers 400 there. */
export async function getAssessments(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const rows = await listAll.call(this, '/hiring/interview-sets/v1');
	return rows
		.filter(
			(row) =>
				row.set_type === null ||
				row.set_type === undefined ||
				String(row.set_type) in invitableSetTypes,
		)
		.map((row) => {
			const kind =
				row.set_type === null || row.set_type === undefined
					? ''
					: invitableSetTypes[String(row.set_type)];
			return {
				name: kind ? `${String(row.title)} (${kind})` : String(row.title),
				value: String(row.id),
			};
		});
}

export async function getJobPosts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const projectId = currentProjectId(this);
	const rows = await listAll.call(
		this,
		'/hiring/job-posts/v1',
		projectId ? { com_project_id: projectId } : {},
	);
	return rows.map((row) => ({ name: String(row.title), value: String(row.id) }));
}

/** The stage list is not paged and answers an empty list for a project that is not yours. */
export async function getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const projectId = currentProjectId(this);
	if (!projectId) return [];
	const response = await flowmingoApiRequest.call(
		this,
		'GET',
		`/hiring/projects/${encodeURIComponent(projectId)}/stages/v1`,
	);
	return rowsOf(response).map((row) => ({ name: String(row.name), value: String(row.id) }));
}
