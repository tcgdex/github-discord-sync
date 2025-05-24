import express from "express"
import bodyParser from "body-parser"
import {
	ThreadChannel,
	Message,
	type AnyThreadChannel,
} from "discord.js"
import { createThread, destroyDiscord, discord, initDiscord, listDiscordMessages, listDiscordThreads, pushDiscordMessage } from "./discord"
import logger from "./config/logger"
import { createDiscussion, fetchRepoCategoryIdByName, listGithubDiscussions, listGithubComments, loadGithub, pushGithubComment, updateDiscussion, type GithubDiscussion } from "./github"

// Configuration (with environment variable fallbacks)
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || "1375527112521552003"
const CATEGORY_NAME = process.env.CATEGORY_NAME || "General"
const DRY_RUN = process.env.DRY_RUN === "true" || false

const app = express();
app.use(bodyParser.json());


// GitHub → Discord (discussion and comment webhooks)
app.all("/webhook", async (req: express.Request, res: express.Response) => {
	try {
		const event = req.headers["x-github-event"];

		// Handle new discussions
		if (event === "discussion" && req.body.action === "created") {
			logger.info("Received discussion creation event");
			await syncDiscussionOnDiscord(req.body.discussion);
		}

		// Handle new discussion comments
		else if (event === "discussion_comment" && req.body.action === "created") {
			logger.info("Received discussion comment event");
			await syncDiscussionOnDiscord(req.body.discussion);
		}

		res.sendStatus(200);
	} catch (e) {
		logger.error(`Webhook handler error: ${e}`);
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

		await syncThreadOnGitHub(thread as AnyThreadChannel);
	} catch (e: any) {
		logger.error(`Discord threadCreate error: ${e.message}`);
		try {
			await thread.send(`Failed to create GitHub discussion: ${e.message}`);
		} catch (sendError) {
			logger.error(`Failed to send error message to thread: ${sendError}`);
		}
	}
});

// Discord → GitHub (sync messages from Discord threads to GitHub discussions)
discord.on("messageCreate", async (message: Message) => {
	try {
		// Only process messages in threads
		if (!message.channel.isThread()) {
			logger.info("message not in thread");
			return;
		}

		const thread = message.channel as AnyThreadChannel;
		if (thread.parentId !== FORUM_CHANNEL_ID) {
			logger.info("thread not in forum channel");
			return;
		}

		// Ignore bot messages and messages that appear to be synced from GitHub
		if (message.author.bot || message.content.includes("💬 **")) {
			logger.info("message ignored");
			return;
		}

		await syncThreadOnGitHub(thread);
	} catch (e: any) {
		logger.error(`Discord messageCreate error: ${e.message}`);
		try {
			await message.reply("Failed to sync to GitHub: " + e.message);
		} catch (replyError) {
			logger.error(`Failed to send error reply: ${replyError}`);
		}
	}
});

async function findThreadOnGitHub(thread: AnyThreadChannel) {
	// find the discussion that the first message contains the thread ID
	const discussion = (await listGithubDiscussions())
		.find((it) => it.body.includes(`<!-- Discord:${thread.id} -->`));

	return discussion;
}

async function findDiscussionOnDiscord(discussion: GithubDiscussion) {
	const threads = await listDiscordThreads();
	// <!-- Discord:1375561398364668025 -->
	const id = /<!-- Discord:(\d+) -->/g.exec(discussion.body)?.[1];
	return threads.find((it) => it.id === id);
}

/**
 * Sync a discussion from GitHub to Discord.
 */
async function syncDiscussionOnDiscord(discussion: GithubDiscussion) {
	if (discussion.category?.name !== CATEGORY_NAME) {
		logger.info('skipping discussion not in the correct category')
		return
	}
	let thread = await findDiscussionOnDiscord(discussion);
	if (!thread) {
		logger.info('Creating thread on Discord')
		if (DRY_RUN) {
			logger.info('Dry run: Skipping creation of thread on Discord')
			return;
		}
		const res = await createThread(discussion.author.login, discussion.number, discussion.title, discussion.body);
		if (!res) {
			logger.alert(`Failed to create thread on Discord forum ${FORUM_CHANNEL_ID}: ${discussion.title}`);
			return;
		}
		await updateDiscussion(discussion, res.id);
		thread = res;
	}

	await syncMessages(thread, discussion);
}

/**
 * Sync a thread from Discord to GitHub.
 */
async function syncThreadOnGitHub(thread: AnyThreadChannel) {
	let discussion = await findThreadOnGitHub(thread);
	if (!discussion) {
		logger.info('Creating discussion on GitHub')
		if (DRY_RUN) {
			logger.info('Dry run: Skipping creation of discussion on GitHub')
			return;
		}
		discussion = await createDiscussion(thread, (await thread.messages.fetch()).reverse().at(0)!);
		if (!discussion) {
			logger.alert(`Failed to create discussion on GitHub category ${CATEGORY_NAME}: ${thread.name}`);
			return;
		}
	}

	await syncMessages(thread, discussion);
}

async function syncMessages(thread: AnyThreadChannel, discussion: GithubDiscussion) {
	logger.info(`Loading messages from thread ${thread.id} & discussion ${discussion.id}`)
	const [
		threadMessages,
		discussionMessages
	] = await Promise.all([
		listDiscordMessages(thread),
		listGithubComments(discussion)
	])

	if (threadMessages.length === discussionMessages.length) {
		logger.info(`No new messages to sync between Discord thread ${thread.id} & GitHub discussion ${discussion.id}`)
		return;
	}

	const way = threadMessages.length < discussionMessages.length ? "discord" : "github";

	if (way === "discord") {
		logger.info('Syncing messages from GitHub to Discord')
		if (DRY_RUN) {
			logger.info('Dry run enabled, skipping actual sync')
		} else {
			for (let idx = threadMessages.length; idx < discussionMessages.length; idx++) {
				const message = discussionMessages[idx]!;
				await pushDiscordMessage(thread, message, discussion);
			}
		}
	} else {
		logger.info('Syncing messages from Discord to GitHub')
		if (DRY_RUN) {
			logger.info('Dry run enabled, skipping actual sync')
		} else {
			for (let idx = discussionMessages.length; idx < threadMessages.length; idx++) {
				const message = threadMessages[idx]!;
				await pushGithubComment(thread, message, discussion);
			}
		}
	}

	return null;
}

// Initialize, fetch category ID and start
async function init() {
	// load deps
	logger.info("Initializing GitHub/Discord...");

	await Promise.all([
		initDiscord().then(() => logger.info('Discord ready !')),
		loadGithub().then(() => logger.info('Github ready !'))
	])

	logger.info('Syncing existing Discord threads to Github')
	const threads = await listDiscordThreads();
	for (const thread of threads) {
		logger.info(`Syncing thread ${thread[0]}`)
		await syncThreadOnGitHub(thread[1])
	}
	const discussions = await listGithubDiscussions();
	for (const discussion of discussions) {
		logger.info(`Syncing Discussion ${discussion.number}`)
		await syncDiscussionOnDiscord(discussion)
	}

	// Set up Express server
	const port = process.env.PORT || 3000;
	app.listen(port, () =>
		logger.info(`Webhook server listening on port ${port}${DRY_RUN ? " (dry run mode)" : ""}`)
	)

	// Handle graceful shutdown
	process.on("SIGINT", gracefulShutdown)
	process.on("SIGTERM", gracefulShutdown)
}

function gracefulShutdown() {
	logger.info("Shutting down gracefully...")

	// Close Discord connection
	destroyDiscord()

	// Give processes a moment to close
	setTimeout(() => {
		logger.info("Shutdown complete")
		process.exit(0)
	}, 1000)
}

init()
