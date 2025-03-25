#!/bin/bash

# Exit on error
set -e

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

echo "🚀 Setting up federation examples..."

# Use nvm and install dependencies
echo "📦 Setting up Node.js environment..."
nvm use
pnpm install

# Build the main package
echo "🏗️ Building main package..."
pnpm build

# Function to setup a federation example
setup_example() {
    local dir=$1
    echo "🔄 Setting up $dir..."
    cd "examples/federation/$dir"
    
    echo "📦 Installing dependencies..."
    pnpm install
    
    echo "📦 Running Prisma and Playwright setup..."
    pnpm prisma generate && \
    pnpm prisma migrate reset --force && \
    pnpm playwright install && \
    pnpm run build
    
    cd ../../..
}

# Setup both federation examples
setup_example "epic-stack"
setup_example "epic-stack-remote"

echo "✅ Setup complete!" 