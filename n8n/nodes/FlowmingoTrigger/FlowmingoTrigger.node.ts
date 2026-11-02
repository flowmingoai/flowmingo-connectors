import type {
	IDataObject,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import contract from '../Flowmingo/contract.json';
import { flowmingoApiRequest, rowsOf } from '../Flowmingo/transport';

const PAGE_LIMIT = 100;
// One poll reads at most this many pages; a backlog larger than that is picked up by the following polls.
const MAX_PAGES = 5;
// Event ids remembered between polls, to recognise where the previous poll stopped.
const SEEN_LIMIT = 1000;

type EventDefinition = (typeof contract.events)[number] & {
	sub_event_field?: string;
	sub_event_choices?: Record<string, string>;
};

type FeedEvent = IDataObject & { event_id?: string; event_type?: string; data?: IDataObject };

type PollState = { seenIds?: string[] };

const definitions = contract.events as EventDefinition[];

const filterProperty = (definition: EventDefinition): INodeProperties => ({
	displayName: definition.sub_event_field === 'assessment_type' ? 'Assessment Type' : 'Only When',
	name: `filter_${definition.key}`,
	type: 'options',
	displayOptions: { show: { event: [definition.event_type] } },
	options: [
		{ name: 'Any', value: '' },
		...Object.entries(definition.sub_event_choices ?? {})
			.map(([value, name]) => ({ name, value }))
			.sort((a, b) => a.name.localeCompare(b.name)),
	],
	default: '',
	description: 'Trigger only on this kind of event',
});

const toItem = (event: FeedEvent): INodeExecutionData => ({
	json: {
		...(event.data ?? {}),
		event_id: event.event_id,
		event_type: event.event_type,
		sub_event: event.sub_event ?? null,
		timestamp: event.timestamp,
	},
});

export class FlowmingoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Flowmingo Trigger',
		name: 'flowmingoTrigger',
		icon: { light: 'file:flowmingo.svg', dark: 'file:flowmingo.dark.svg' },
		group: ['trigger'],
		version: [1],
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when something happens in Flowmingo',
		defaults: { name: 'Flowmingo Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'flowmingoApi', required: true }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				required: true,
				options: definitions
					.map((definition) => ({
						name: definition.label,
						value: definition.event_type,
						description: definition.description,
					}))
					.sort((a, b) => a.name.localeCompare(b.name)),
				default: 'application.created',
			},
			...definitions.filter((definition) => definition.sub_event_field).map(filterProperty),
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const eventType = this.getNodeParameter('event') as string;
		const definition = definitions.find((candidate) => candidate.event_type === eventType);
		const filterField = definition?.sub_event_field;
		const wanted =
			definition && filterField
				? (this.getNodeParameter(`filter_${definition.key}`, '') as string)
				: '';
		const matches = (event: FeedEvent) =>
			event.event_type === eventType &&
			(!wanted || (!!filterField && event.data?.[filterField] === wanted));

		// A manual test shows the newest matching event and leaves the state of the active workflow alone.
		if (this.getMode() === 'manual') {
			const response = await flowmingoApiRequest.call(this, 'GET', contract.events_feed.path, {
				qs: { event_type: eventType, limit: PAGE_LIMIT },
			});
			const newest = (rowsOf(response) as FeedEvent[]).find(matches);
			return newest ? [[toItem(newest)]] : null;
		}

		const state = this.getWorkflowStaticData('node') as PollState;
		const isFirstPoll = !Array.isArray(state.seenIds);
		const seen = new Set(state.seenIds ?? []);
		const fresh: FeedEvent[] = [];

		// Newest first: read back until a page holds an event the previous poll saw.
		let cursor: string | undefined;
		for (let page = 0; page < MAX_PAGES; page++) {
			const response = await flowmingoApiRequest.call(this, 'GET', contract.events_feed.path, {
				qs: { event_type: eventType, limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
			});
			const events = (rowsOf(response) as FeedEvent[]).filter(
				(event) => typeof event.event_id === 'string' && event.event_id.length > 0,
			);
			const unseen = events.filter((event) => !seen.has(event.event_id as string));
			fresh.push(...unseen);
			const nextCursor =
				typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
			if (isFirstPoll || unseen.length < events.length || !nextCursor) break;
			cursor = nextCursor;
		}

		state.seenIds = [
			...fresh.map((event) => event.event_id as string),
			...(state.seenIds ?? []),
		].slice(0, SEEN_LIMIT);

		// The first poll after activation only records where the feed stands, so 30 days of history are not replayed.
		if (isFirstPoll) return null;

		const items = fresh.filter(matches).reverse().map(toItem);
		return items.length ? [items] : null;
	}
}
