##############
# Base build #
##############
FROM oven/bun:1.2-alpine

# Change the base working directory
WORKDIR /usr/src/app

# Add package json
ADD package.json bun.lock ./

# install dependencies from lockfile
RUN bun install --frozen-lockfile

# Add project files
ADD . .

# inform software to be in production
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# run it !
CMD ["bun", "./src/index.ts"]
