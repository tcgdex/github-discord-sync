import express from "express";
import bodyParser from "body-parser";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import {
	Client,
	GatewayIntentBits,
	TextChannel,
	ThreadChannel,
	Message,
	ForumChannel,
	type AnyThreadChannel,
} from "discord.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Add TypeScript ignore directive for GitHub Discussions API
// @ts-ignore - GitHub Discussions API is not fully typed in Octokit

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// Check if tokens are available
if (!GITHUB_TOKEN) {
	console.error("Error: GITHUB_TOKEN is not set in environment variables");
	process.exit(1);
}

if (!DISCORD_TOKEN) {
	console.error("Error: DISCORD_TOKEN is not set in environment variables");
	process.exit(1);
}

// Configuration (with environment variable fallbacks)
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || "1375527112521552003";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "";
const CATEGORY_NAME = process.env.CATEGORY_NAME || "General";
const DRY_RUN = process.env.DRY_RUN === "true" || false;

// Type definitions for our application
type GithubDiscussion = {
	id: string;
	number: number;
	title: string;
	body: string;
	author: {
		login: string;
	};
};

type GithubComment = {
	id: string;
	databaseId: number;
	body: string;
	author: {
		login: string;
	};
};

type GithubCategory = {
	id: string;
	name: string;
};

// GraphQL typed client
const graphqlWithAuth = graphql.defaults({
	headers: {
		authorization: `token ${GITHUB_TOKEN}`,
	},
});

// Create GitHub API client
// REST API client for non-discussion API calls
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Logging utility
enum LogLevel {
	INFO = "INFO",
	SUCCESS = "SUCCESS",
	WARNING = "WARNING",
	ERROR = "ERROR",
	DRY_RUN = "DRY_RUN",
}

const syncStats = {
	githubDiscussionsFound: 0,
	discordThreadsFound: 0,
	syncedToDiscord: 0,
	syncedToGitHub: 0,
};

function log(level: LogLevel, message: string, details?: any): void {
	const timestamp = new Date().toISOString();
	const emoji = {
		[LogLevel.INFO]: "ℹ️",
		[LogLevel.SUCCESS]: "✅",
		[LogLevel.WARNING]: "⚠️",
		[LogLevel.ERROR]: "❌",
		[LogLevel.DRY_RUN]: "🔍",
	}[level];

	if (details) {
		console.log(
			`${timestamp} ${emoji} [${level}] ${message}:`,
			typeof details === "object" ? JSON.stringify(details, null, 2) : details,
		);
	} else {
		console.log(`${timestamp} ${emoji} [${level}] ${message}`);
	}
}

// Helper function for dry run logs
function dryRunLog(action: string, details: any): void {
	if (DRY_RUN) {
		log(LogLevel.DRY_RUN, `DRY RUN - ${action}`, details);
	}
}

/**
 * Process GitHub user-attachments in content for proper display in Discord
 * @param content Text content that may contain GitHub attachments
 * @returns Processed content with attachments formatted for Discord
 */
function processGitHubAttachments(content: string): string {
	let processedContent = content;

	// Handle GitHub user-attachments in HTML format
	// <img width="2718" alt="graphique IA" src="https://github.com/user-attachments/assets/id" />
	processedContent = processedContent.replace(
		/<img.*?src="(https:\/\/github\.com\/user-attachments\/assets\/[^"]+)".*?\/>/g,
		function (match, url) {
			// Force the URL to be displayed on its own line for proper Discord embedding
			return "\n" + url + "\n";
		},
	);

	// Also handle other HTML image tags for any URLs
	processedContent = processedContent.replace(/<img.*?src="(https?:\/\/[^"]+)".*?\/>/g, function (match, url) {
		return "\n" + url + "\n";
	});

	// Handle GitHub user-attachments URLs - make sure they're on their own lines for Discord embedding
	const attachmentRegex = /(https:\/\/github\.com\/user-attachments\/assets\/[a-zA-Z0-9-]+)/g;
	let match;
	while ((match = attachmentRegex.exec(processedContent)) !== null) {
		// If the attachment URL is not surrounded by whitespace, add newlines
		const position = match.index;
		const fullMatch = match[0];
		const before = processedContent.charAt(position - 1) || "\n";
		const after = processedContent.charAt(position + fullMatch.length) || "\n";

		if (before !== "\n") {
			processedContent = processedContent.slice(0, position) + "\n" + processedContent.slice(position);
			// Adjust the regex's lastIndex due to the added character
			attachmentRegex.lastIndex += 1;
		}

		if (after !== "\n") {
			const insertPosition = position + fullMatch.length + (before !== "\n" ? 1 : 0);
			processedContent =
				processedContent.slice(0, insertPosition) + "\n" + processedContent.slice(insertPosition);
			// Adjust the regex's lastIndex due to the added character
			attachmentRegex.lastIndex += 1;
		}
	}

	return processedContent;
}

/**
 * Convert GitHub user-attachments in content to Markdown format for GitHub
 * @param content Text content that may contain GitHub attachment URLs
 * @returns Processed content with attachments formatted for GitHub as Markdown
 */
function convertAttachmentsToMarkdown(content: string): string {
	let processedContent = content;

	// First, extract and handle HTML image tags
	// Replace <img> tags with markdown
	processedContent = processedContent.replace(/<img.*?src="(https?:\/\/[^"]+)".*?alt="([^"]*)".*?\/>/gi, "![$2]($1)");

	// Handle HTML image tags without alt text
	processedContent = processedContent.replace(/<img.*?src="(https?:\/\/[^"]+)".*?\/>/gi, "![Image]($1)");

	// Handle GitHub user-attachments
	const githubAttachmentRegex = /(https:\/\/github\.com\/user-attachments\/assets\/[a-zA-Z0-9-]+)/gi;

	// Convert GitHub attachment URLs to markdown image format (only if they're not already in markdown format)
	processedContent = processedContent.replace(githubAttachmentRegex, function (match) {
		if (processedContent.includes(`![`) && processedContent.includes(`](${match})`)) {
			return match; // Already in markdown format
		}
		return "![GitHub Image](" + match + ")";
	});

	return processedContent;
}
// NOTE: MessageContent is a privileged intent that must be enabled in the Discord Developer Portal
// Go to https://discord.com/developers/applications > Your Bot > Bot > Privileged Gateway Intents
// Enable "MESSAGE CONTENT INTENT"
const discord = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
	rest: {
		retries: 3,
	},
});

const app = express();
app.use(bodyParser.json());

let REPO_CATEGORY_ID: string | null = null; // will be set at startup

async function fetchRepoCategoryIdByName(name: string, createIfNotExists: boolean = true): Promise<string> {
	try {
		// First check if the repository exists and has discussions enabled
		try {
			const repoResult = await graphqlWithAuth(
				`
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            id
            hasDiscussionsEnabled
          }
        }
      `,
				{ owner: GITHUB_OWNER, repo: GITHUB_REPO },
			);

			if (!repoResult.repository) {
				throw new Error(
					`Repository ${GITHUB_OWNER}/${GITHUB_REPO} not found. Check your GITHUB_OWNER and GITHUB_REPO settings.`,
				);
			}

			if (!repoResult.repository.hasDiscussionsEnabled) {
				throw new Error(
					`Discussions are not enabled on repository ${GITHUB_OWNER}/${GITHUB_REPO}. Enable them in repository settings.`,
				);
			}
		} catch (repoError: any) {
			log(LogLevel.ERROR, `Repository check failed: ${repoError.message}`);
			throw repoError;
		}

		// Now fetch discussion categories
		const result = await graphqlWithAuth(
			`
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          discussionCategories(first: 50) {
            nodes {
              id
              name
            }
          }
        }
      }
    `,
			{ owner: GITHUB_OWNER, repo: GITHUB_REPO },
		);

		if (!result.repository) {
			throw new Error(`Could not access repository ${GITHUB_OWNER}/${GITHUB_REPO}`);
		}

		const categories = result.repository.discussionCategories.nodes;
		const cat = categories.find((c: GithubCategory) => c.name === name);

		// If category doesn't exist and createIfNotExists is true, create it
		if (!cat && createIfNotExists) {
			log(LogLevel.INFO, `Category '${name}' not found. Attempting to create it...`);
			try {
				const createResult = await graphqlWithAuth(
					`
          mutation($repositoryId: ID!, $name: String!, $description: String) {
            createDiscussionCategory(input: {
              repositoryId: $repositoryId,
              name: $name,
              description: $description
            }) {
              category {
                id
              }
            }
          }
        `,
					{
						repositoryId: await getRepositoryId(),
						name: name,
						description: `Auto-created category for GitHub-Discord sync`,
					},
				);

				return createResult.createDiscussionCategory.category.id;
			} catch (createError: any) {
				log(LogLevel.ERROR, `Failed to create category '${name}': ${createError.message}`);
				throw new Error(`Category '${name}' not found and could not be created. Error: ${createError.message}`);
			}
		} else if (!cat) {
			throw new Error(`Category '${name}' not found in repository ${GITHUB_OWNER}/${GITHUB_REPO}`);
		}

		return cat.id;
	} catch (error: any) {
		log(LogLevel.ERROR, `Failed to fetch or create category with name '${name}': ${error.message}`);
		throw error;
	}
}

// GitHub → Discord (discussion and comment webhooks)
app.all("/webhook", async (req: express.Request, res: express.Response) => {
	try {
		const event = req.headers["x-github-event"];

		// Handle new discussions
		if (event === "discussion" && req.body.action === "created") {
			log(LogLevel.INFO, "Received discussion creation event");
			await syncDiscussionOnDiscord(req.body.discussion);
		}

		// Handle new discussion comments
		else if (event === "discussion_comment" && req.body.action === "created") {
			log(LogLevel.INFO, "Received discussion comment event");
			const comment = req.body.comment;
			const discussion = req.body.discussion;
			await syncDiscussionOnDiscord(req.body.discussion);
		}

		res.sendStatus(200);
	} catch (e) {
		log(LogLevel.ERROR, `Webhook handler error: ${e}`);
		res.sendStatus(500);
	}
});

// Discord → GitHub (new thread creates org discussion)
discord.on("threadCreate", async (thread: ThreadChannel) => {
	return;
	try {
		if (thread.parentId !== FORUM_CHANNEL_ID) return;

		const messages = await thread.messages.fetch({ limit: 1 });
		const msg = messages.first();
		if (!msg) return;

		if (!REPO_CATEGORY_ID) {
			console.error("REPO_CATEGORY_ID is not set!");
			return;
		}

		await syncThreadOnGitHub(thread as AnyThreadChannel);
	} catch (e: any) {
		log(LogLevel.ERROR, `Discord threadCreate error: ${e.message}`);
		try {
			await thread.send(`Failed to create GitHub discussion: ${e.message}`);
		} catch (sendError) {
			log(LogLevel.ERROR, `Failed to send error message to thread: ${sendError}`);
		}
	}
});

// Discord → GitHub (sync messages from Discord threads to GitHub discussions)
discord.on("messageCreate", async (message: Message) => {
	try {
		// Only process messages in threads
		if (!message.channel.isThread()) {
			log(LogLevel.INFO, "message not in thread");
			return;
		}

		const thread = message.channel as AnyThreadChannel;
		if (thread.parentId !== FORUM_CHANNEL_ID) {
			log(LogLevel.INFO, "thread not in forum channel");
			return;
		}

		// Ignore bot messages and messages that appear to be synced from GitHub
		if (message.author.bot || message.content.includes("💬 **")) {
			log(LogLevel.INFO, "message ignored");
			return;
		}

		await syncThreadOnGitHub(thread);
	} catch (e: any) {
		log(LogLevel.ERROR, `Discord messageCreate error: ${e.message}`);
		try {
			await message.reply("Failed to sync to GitHub: " + e.message);
		} catch (replyError) {
			log(LogLevel.ERROR, `Failed to send error reply: ${replyError}`);
		}
	}
});

interface Discussion {
	body: string;
	author: string;
	id: string;
	number: number;
	title: string;
}

async function updateDiscussion(discussion: Discussion, discordId: string): Promise<void> {
	if (DRY_RUN) {
		console.log(`DRY_RUN: Would update discussion #${discussion.number} with body: ${discussion.body}`);
		return;
	}

	console.log(`Updating discussion #${discussion.number} with body: ${discussion.body}`);
	await graphqlWithAuth(
		`
		mutation($id: ID!, $body: String!) {
			updateDiscussion(input: {
				discussionId: $id,
				body: $body
			}) {
				discussion {
					id
				}
			}
		}
		`,
		{
			id: discussion.id,
			body: `${discussion.body}\n\n<!-- Discord:${discordId} -->`,
		},
	);

	await new Promise((resolve) => setTimeout(resolve, 1000));
}

let discussionCache: Array<Discussion> | undefined = undefined;

async function listDiscussions(): Promise<Array<Discussion>> {
	if (discussionCache) return discussionCache;
	const discussions = await graphqlWithAuth<{
		repository: {
			discussions: {
				totalCount: number;
				nodes: Array<Omit<Discussion, "author"> & { author: { login: string } }>;
			};
		};
	}>(
		`
		query ($owner: String!, $name: String!, $id: ID!) {
			repository(owner: $owner, name: $name) {
				discussions(categoryId: $id, first: 100) {
					totalCount
					nodes {
						id
						body
						number
						title
						author {
							login
						}
					}
				}
			}
		}
		`,
		{ owner: GITHUB_OWNER, name: GITHUB_REPO, id: REPO_CATEGORY_ID },
	);

	if (!discussions) {
		throw new Error(`Discussions not found.`);
	}
	discussionCache = discussions.repository.discussions.nodes.map((it) => ({
		body: it.body,
		author: it.author.login,
		id: it.id,
		number: it.number,
		title: it.title,
	}));
	await new Promise((resolve) => setTimeout(resolve, 1000));

	return discussionCache;
}

interface GitHubComment {
	id: string;
	body: string;
	author: string;
}

async function listGitHubComments(discussion: Discussion) {
	const comments: Array<GitHubComment> = [];
	let offset: string | undefined = undefined;
	let hasNextPage = true;
	while (hasNextPage) {
		const res = await graphqlWithAuth<{
			repository: {
				discussion: {
					comments: {
						totalCount: number;
						nodes: Array<GitHubComment>;
						pageInfo: { hasNextPage: boolean; endCursor: string };
					};
				};
			};
		}>(
			`
			query ($owner: String!, $name: String!, $id: Int!, $offset: String) {
				repository(owner: $owner, name: $name) {
					discussion(number: $id) {
						id
						number
						body
						comments(first: 100, after: $offset) {
							totalCount
							nodes {
								id
								body
								author {
									login
								}
							}
							pageInfo{
								hasNextPage
								endCursor
							}
						}
					}
				}
			}
			`,
			{ owner: GITHUB_OWNER, name: GITHUB_REPO, id: discussion.number, offset: offset },
		);
		offset = res.repository.discussion.comments.pageInfo.endCursor;
		hasNextPage = res.repository.discussion.comments.pageInfo.hasNextPage;
		comments.push(
			...res.repository.discussion.comments.nodes.map((comment) => ({
				id: comment.id,
				body: comment.body,
				author: comment.author.login,
			})),
		);

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	return comments;
}

async function listDiscordThreads() {
	const forum = (await discord.channels.fetch(FORUM_CHANNEL_ID)) as ForumChannel;
	return (await forum.threads.fetch()).threads;
}

interface ThreadMessage {
	id: string;
	message: string;
	user: string;
	isAuthor: boolean;
	fromGithub: boolean;
}

async function listDiscordMessages(thread: AnyThreadChannel): Promise<Array<ThreadMessage>> {
	return (await thread.messages.fetch())
		.map((message) => ({
			id: message.id,
			message: message.content,
			user: message.author.username,
			isAuthor: message.author.id === discord.user!.id,
			fromGithub: message.content.match(/^🔄 \\*\\*.*\\*\\* on GitHub wrote:\\n/) !== null,
		}))
		.toReversed()
		.filter((_, idx) => idx > 0);
}

async function findThreadOnGitHub(thread: AnyThreadChannel) {
	// find discussions that match the title
	// find the discussion that the first message contains the thread ID
	const discussion = (await listDiscussions())
		.filter((it) => it.title === thread.name)
		.find((it) => it.body.includes(thread.id));

	return discussion;
}

async function findDiscussionOnDiscord(discussion: Discussion) {
	const threads = await listDiscordThreads();
	// <!-- Discord:1375561398364668025 -->
	const id = /<!-- Discord:(\d+) -->/g.exec(discussion.body)?.[1];
	return threads.find((it) => it.id === id);
}

function makeDiscordMessage(author: string, number: number, body: string) {
	// Handle Discord message length limit (2000 chars)
	const messagePrefix = `💬 **${author}** on [GitHub](<https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/discussions/${number}>) wrote:\n`;
	const maxContentLength = 1900 - messagePrefix.length;

	// Process content to handle image links correctly
	let processedBody = body;

	// Convert GitHub image syntax to Discord-friendly format
	// Discord will automatically embed images when their URLs are posted
	// ![alt text](https://url.to/image.png) -> https://url.to/image.png
	processedBody = processedBody.replace(/!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, "$2");

	// Process GitHub user-attachments and HTML image tags for Discord
	processedBody = processGitHubAttachments(processedBody);

	return `${messagePrefix}${
		processedBody.length > maxContentLength
			? processedBody.substring(0, maxContentLength) + "\n(continued...)"
			: processedBody
	}`;
}

function makeGithubComment(message: string, author: string, url: string) {
	// Check if message exceeds GitHub's comment size limit (65536 chars)
	const processedContent = convertAttachmentsToMarkdown(message);
	return `💬 **${author}** on [Discord](${url}) wrote:\n\n${processedContent}`;
}

async function createDiscussion(thread: AnyThreadChannel, message: Message) {
	const author = message.author.username;
	const url = `https://discord.com/channels/${thread.guild.id}/${thread.id}/${message.id}`;

	if (DRY_RUN) {
		console.log(`[DRY RUN] Creating discussion on GitHub repository ${CATEGORY_NAME}: ${thread.name}`);
		return;
	}

	console.log(`Creating discussion on GitHub repository ${CATEGORY_NAME}: ${thread.name}`);
	const result = await graphqlWithAuth(
		`
        mutation($categoryId: ID!, $body: String!, $title: String!, $repositoryId: ID!) {
          createDiscussion(input: {
            categoryId: $categoryId,
            body: $body,
            title: $title,
            repositoryId: $repositoryId
          }) {
            discussion {
              id
              number
            }
          }
        }
      `,
		{
			categoryId: REPO_CATEGORY_ID,
			title: thread.name,
			body: makeGithubComment(message.content + `\n\n<!-- Discord:${thread.id} -->`, author, url),
			repositoryId: await getRepositoryId(),
		},
	);

	// wait for the discussion to be created and be available in the API
	await new Promise((resolve) => setTimeout(resolve, 1000));

	return result.createDiscussion.discussion as Discussion;
}

async function createThread(author: string, number: number, title: string, body: string) {
	const forum = (await discord.channels.fetch(FORUM_CHANNEL_ID)) as ForumChannel;

	if (DRY_RUN) {
		console.log(`[DRY RUN] Creating thread on Discord forum ${forum.id}: ${title}`);
		return;
	}

	console.log(`Creating thread on Discord forum ${forum.id}: ${title}`);
	const thread = await forum.threads.create({
		name: title,
		message: {
			content: makeDiscordMessage(author, number, body),
		},
	});

	return thread;
}

async function pushDiscordMessage(thread: AnyThreadChannel, comment: GitHubComment, discussion: Discussion) {
	if (DRY_RUN) {
		console.log(`[DRY RUN] Sending message to Discord thread ${thread.id}: ${comment.body}`);
		return;
	}
	console.log(`Sending message to Discord thread ${thread.id}: ${comment.body}`);
	await thread.send(makeDiscordMessage(comment.author, discussion.number, comment.body));
}

async function pushGithubComment(thread: AnyThreadChannel, message: ThreadMessage, discussion: Discussion) {
	if (DRY_RUN) {
		console.log(`[DRY RUN] Sending comment to GitHub discussion ${discussion.number}: ${message.message}`);
		return;
	}
	const url = `https://discord.com/channels/${thread.guild.id}/${thread.id}/${message.id}`;

	console.log(`Sending comment to GitHub discussion ${discussion.number}: ${message.message}`);
	await graphqlWithAuth(
		`
			mutation($discussionId: ID!, $body: String!) {
				addDiscussionComment(input: {
					discussionId: $discussionId,
					body: $body
				}) {
					comment {
						id
					}
				}
			}
		`,
		{
			discussionId: discussion.id,
			body: makeGithubComment(message.message, message.user, url),
		},
	);

	await new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * Sync a discussion from GitHub to Discord.
 */
async function syncDiscussionOnDiscord(discussion: Discussion) {
	let thread = await findDiscussionOnDiscord(discussion);
	if (!thread) {
		// create thread
		// post messages
		const res = await createThread(discussion.author, discussion.number, discussion.title, discussion.body);
		if (!res) {
			console.log(`[DRY RUN] Failed to create thread on Discord forum ${FORUM_CHANNEL_ID}: ${discussion.title}`);
			return;
		}
		await updateDiscussion(discussion, res.id);
		thread = res;
	}

	await syncMessages(thread, discussion);
}

/**
 * Sync a discussion from GitHub to Discord.
 */
async function syncThreadOnGitHub(thread: AnyThreadChannel) {
	let discussion = await findThreadOnGitHub(thread);
	if (!discussion) {
		// create thread
		// post messages
		discussion = await createDiscussion(thread, (await thread.messages.fetch()).reverse().at(0)!);
		if (!discussion) {
			console.log(`[DRY RUN] Failed to create discussion on GitHub category ${CATEGORY_NAME}: ${thread.name}`);
			return;
		}
	}

	await syncMessages(thread, discussion);
}

async function syncMessages(thread: AnyThreadChannel, discussion: Discussion) {
	const threadMessages = await listDiscordMessages(thread);
	const discussionMessages = await listGitHubComments(discussion);

	const way = threadMessages.length < discussionMessages.length ? "discord" : "github";

	if (way === "discord") {
		for (let idx = threadMessages.length; idx < discussionMessages.length; idx++) {
			const message = discussionMessages[idx]!;
			await pushDiscordMessage(thread, message, discussion);
		}
	} else {
		for (let idx = discussionMessages.length; idx < threadMessages.length; idx++) {
			const message = threadMessages[idx]!;
			await pushGithubComment(thread, message, discussion);
		}
	}

	return null;
}

// Helper function to get repository ID for discussions
async function getRepositoryId(): Promise<string> {
	try {
		const result = await graphqlWithAuth(
			`
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
        }
      }
    `,
			{ owner: GITHUB_OWNER, repo: GITHUB_REPO },
		);

		if (!result.repository) {
			throw new Error(
				`Repository ${GITHUB_OWNER}/${GITHUB_REPO} not found. Check your GITHUB_OWNER and GITHUB_REPO settings.`,
			);
		}

		return result.repository.id;
	} catch (error: any) {
		log(LogLevel.ERROR, `Failed to fetch repository ID: ${error.message}`);
		throw new Error(`Cannot access repository: ${error.message}`);
	}
}

// Initialize, fetch category ID and start
async function init() {
	// Always fetch real category ID
	try {
		REPO_CATEGORY_ID = await fetchRepoCategoryIdByName(CATEGORY_NAME);
		log(LogLevel.INFO, `Using Repository Category ID: ${REPO_CATEGORY_ID}`);
	} catch (categoryError: any) {
		log(LogLevel.ERROR, `Category initialization failed: ${categoryError.message}`);
		process.exit(1);
	}

	await discord.login(DISCORD_TOKEN);
	// const threads = await listThreads();
	// for (const thread of threads) {
	// 	console.log(thread[1].name, await findThreadOnGitHub(thread[1]));
	// 	// console.log(await listComments(thread[1]));
	// }

	const discussions = await listDiscussions();
	for (const discussion of discussions) {
		// console.log(discussion);
		await syncDiscussionOnDiscord(discussion);
	}

	const threads = await listDiscordThreads();
	for (const thread of threads) {
		await syncThreadOnGitHub(thread[1]);
	}

	// Set up Express server
	const port = process.env.PORT || 3000;
	app.listen(port, () =>
		log(LogLevel.INFO, `Webhook server listening on port ${port}${DRY_RUN ? " (dry run mode)" : ""}`),
	);

	// Handle graceful shutdown
	process.on("SIGINT", gracefulShutdown);
	process.on("SIGTERM", gracefulShutdown);

	return;
}

function gracefulShutdown() {
	log(LogLevel.INFO, "Shutting down gracefully...");

	// Close Discord connection
	discord.destroy();

	// Give processes a moment to close
	setTimeout(() => {
		log(LogLevel.INFO, "Shutdown complete");
		process.exit(0);
	}, 1000);
}

init();
