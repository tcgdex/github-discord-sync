import { graphql } from "@octokit/graphql"
import type { AnyThreadChannel, Message } from "discord.js"
import { Octokit } from "@octokit/rest"
import logger from "./config/logger"
import type { ThreadMessage } from "./discord";

const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID || "1375527112521552003";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "";
const CATEGORY_NAME = process.env.CATEGORY_NAME || "General";

let REPO_CATEGORY_ID: string | null = null; // will be set at startup

// Type definitions for our application
export type GithubDiscussion = {
	id: string
	number: number
	title: string
	body: string
	author: {
		login: string
	}
}

export type GithubComment = {
	id: string
	databaseId: number
	body: string
	author: {
		login: string
	}
}

export type GithubCategory = {
	id: string
	name: string
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN

// Check if tokens are available
if (!GITHUB_TOKEN) {
	logger.critical("[Github] Error: GITHUB_TOKEN is not set in environment variables")
	process.exit(1)
}

const octokit = new Octokit({ auth: GITHUB_TOKEN })

// GraphQL typed client
const graphqlWithAuth = graphql.defaults({
	headers: {
		authorization: `token ${GITHUB_TOKEN}`,
	},
});

export async function loadGithub() {
	REPO_CATEGORY_ID = await fetchRepoCategoryIdByName(CATEGORY_NAME);
}

export async function pushGithubComment(thread: AnyThreadChannel, message: ThreadMessage, discussion: GithubDiscussion) {
	const url = `https://discord.com/channels/${thread.guild.id}/${thread.id}/${message.id}`

	logger.info(`[Github] Sending comment to GitHub discussion ${discussion.number}: ${message.message}`)
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
			body: makeGithubComment(message.message, message.user, url)
		}
	)

	await new Promise((resolve) => setTimeout(resolve, 1000))
}


export async function listGithubComments(discussion: GithubDiscussion) {
	const comments: Array<GithubComment> = [];
	let offset: string | undefined = undefined;
	let hasNextPage = true;
	while (hasNextPage) {
		const res: {
			repository: {
				discussion: {
					comments: {
						totalCount: number;
						nodes: Array<GithubComment>;
						pageInfo: { hasNextPage: boolean; endCursor: string };
					};
				};
			};
		} = await graphqlWithAuth(
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
		comments.push(...res.repository.discussion.comments.nodes)

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	return comments;
}

export async function updateDiscussion(discussion: GithubDiscussion, discordId: string): Promise<void> {
	logger.info(`[Github] Updating discussion #${discussion.number} with body: ${discussion.body}`);
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

function makeGithubComment(message: string, author: string, url: string) {
	// Check if message exceeds GitHub's comment size limit (65536 chars)
	const processedContent = message
	return `💬 **${author}** on [Discord](${url}) wrote:\n\n${processedContent}`;
}

export async function createDiscussion(thread: AnyThreadChannel, message: Message) {
	const author = message.author.username;
	const url = `https://discord.com/channels/${thread.guild.id}/${thread.id}/${message.id}`;

	logger.info(`[Github] Creating discussion on GitHub repository ${CATEGORY_NAME}: ${thread.name}`);
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

	return result.createDiscussion.discussion as GithubDiscussion;
}


let discussionCache: Array<GithubDiscussion> | undefined = undefined;

export async function listGithubDiscussions(): Promise<Array<GithubDiscussion>> {
	if (discussionCache) return discussionCache;
	const discussions = await graphqlWithAuth<{
		repository: {
			discussions: {
				totalCount: number;
				nodes: Array<GithubDiscussion>;
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
	discussionCache = discussions.repository.discussions.nodes

	// rate limit
	await new Promise((resolve) => setTimeout(resolve, 1000));

	return discussionCache;
}


export async function fetchRepoCategoryIdByName(name: string, createIfNotExists: boolean = true): Promise<string> {
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
			logger.error(`[Github] Repository check failed: ${repoError.message}`);
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
		if (!cat) {
			throw new Error(`Category '${name}' not found in repository ${GITHUB_OWNER}/${GITHUB_REPO}`);
		}

		return cat.id;
	} catch (error: any) {
		logger.error(`[Github] Failed to fetch or create category with name '${name}': ${error.message}`);
		throw error;
	}
}

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
		logger.error(`[Github] Failed to fetch repository ID: ${error.message}`);
		throw new Error(`Cannot access repository: ${error.message}`);
	}
}
