import {
	Client,
	ForumChannel,
	GatewayIntentBits,
	type AnyThreadChannel
} from "discord.js"
import logger from "./config/logger"
import type { GithubComment, GithubDiscussion } from "./github"

export interface ThreadMessage {
	id: string
	message: string
	user: string
	isAuthor: boolean
	fromGithub: boolean
}

const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || "1375527112521552003"
const GITHUB_REPO = process.env.GITHUB_REPO || ""
const GITHUB_OWNER = process.env.GITHUB_OWNER || ""

const DISCORD_TOKEN = process.env.DISCORD_TOKEN
if (!DISCORD_TOKEN) {
	logger.critical("[Discord] Error: DISCORD_TOKEN is not set in environment variables")
	process.exit(1)
}

// NOTE: MessageContent is a privileged intent that must be enabled in the Discord Developer Portal
// Go to https://discord.com/developers/applications > Your Bot > Bot > Privileged Gateway Intents
// Enable "MESSAGE CONTENT INTENT"
export const discord = new Client({
	intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
	rest: {
		retries: 3,
	},
})

export async function initDiscord() {
	await discord.login(DISCORD_TOKEN)
}

export async function destroyDiscord() {
	await discord.destroy()
}

export async function listDiscordThreads() {
	const forum = (await discord.channels.fetch(FORUM_CHANNEL_ID)) as ForumChannel
	return (await forum.threads.fetch()).threads
}


export async function listDiscordMessages(thread: AnyThreadChannel): Promise<Array<ThreadMessage>> {
	return (await thread.messages.fetch())
		.map((message) => ({
			id: message.id,
			message: message.content,
			user: message.author.username,
			isAuthor: message.author.id === discord.user!.id,
			fromGithub: message.content.match(/^🔄 \\*\\*.*\\*\\* on GitHub wrote:\\n/) !== null,
		}))
		.toReversed()
		.filter((_, idx) => idx > 0)
}


function makeDiscordMessage(author: string, number: number, body: string) {
	// Handle Discord message length limit (2000 chars)
	const messagePrefix = `💬 **${author}** on [GitHub](<https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/discussions/${number}>) wrote:\n`
	const maxContentLength = 1900 - messagePrefix.length

	// Process content to handle image links correctly
	let processedBody = body

	// Convert GitHub image syntax to Discord-friendly format
	// Discord will automatically embed images when their URLs are posted
	// ![alt text](https://url.to/image.png) -> https://url.to/image.png
	processedBody = processedBody.replace(/!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, "$2")

	// Process GitHub user-attachments and HTML image tags for Discord
	processedBody = (processedBody)

	return `${messagePrefix}${processedBody.length > maxContentLength
		? processedBody.substring(0, maxContentLength) + "\n(continued...)"
		: processedBody
		}`
}


export async function createThread(author: string, number: number, title: string, body: string) {
	const forum = (await discord.channels.fetch(FORUM_CHANNEL_ID)) as ForumChannel

	logger.info(`[Discord] Creating thread on Discord forum ${forum.id}: ${title}`)
	const thread = await forum.threads.create({
		name: title,
		message: {
			content: makeDiscordMessage(author, number, body),
		},
	})

	return thread
}


export async function pushDiscordMessage(thread: AnyThreadChannel, comment: GithubComment, discussion: GithubDiscussion) {
	logger.info(`[Discord] Sending message to Discord thread ${thread.id}: ${comment.body}`)
	await thread.send(makeDiscordMessage(comment.author.login, discussion.number, comment.body))
}
