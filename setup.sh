#!/bin/bash
# setup.sh - Sets up Ralph Wiggum in the current project

mkdir -p plans

# Create prd.json if not exists
if [ ! -f plans/prd.json ]; then
    echo "Creating plans/prd.json..."
    cat > plans/prd.json <<EOL
[
  {
    "story": "Example Task: Create a hello world function",
    "passes": false
  },
  {
    "story": "Example Task: Add a test for the hello world function",
    "passes": false
  }
]
EOL
else
    echo "plans/prd.json already exists, skipping."
fi

# Create progress.txt
touch plans/progress.txt

# Create ralph.sh
echo "Creating plans/ralph.sh..."
cat > plans/ralph.sh <<'EOF'
#!/bin/bash
set -e

# Configuration
MAX_ITERATIONS=${1:-10}
PRD_FILE="plans/prd.json"
PROGRESS_FILE="plans/progress.txt"

# Detect package manager
if [ -f "pnpm-lock.yaml" ]; then
    TEST_CMD="pnpm test"
    TYPE_CMD="pnpm type-check"
elif [ -f "yarn.lock" ]; then
    TEST_CMD="yarn test"
    TYPE_CMD="yarn type-check"
else
    TEST_CMD="npm test"
    TYPE_CMD="npm run typecheck"
fi

echo "🚀 Ralph Wiggum starting..."
echo "Feature list: $PRD_FILE"
echo "Progress log: $PROGRESS_FILE"
echo "Max iterations: $MAX_ITERATIONS"

for ((i=1; i<=MAX_ITERATIONS; i++)); do
    echo "----------------------------------------"
    echo "Iteration $i / $MAX_ITERATIONS"
    echo "----------------------------------------"

    PROMPT="You are an autonomous coding agent (Ralph).
    
Context:
- Tasks are in $PRD_FILE
- History is in $PROGRESS_FILE

Instructions:
1. Read $PRD_FILE. Find the first task where 'passes' is false.
2. Read $PROGRESS_FILE to see previous context.
3. IMPLEMENT that single task.
4. VERIFY it:
   - Run '$TYPE_CMD' (if available/applicable)
   - Run '$TEST_CMD'
   - Fix any errors.
5. UPDATE files:
   - Mark the task as 'passes: true' in $PRD_FILE.
   - Append a summary entry to $PROGRESS_FILE.
6. COMMIT:
   - git add .
   - git commit -m \"Ralph: [Task Name]\"
   
Termination:
- If ALL tasks in $PRD_FILE are true, output: 'promise completed'.
- If you cannot complete the task, output the error and stop.
"

    # Check for agent command
    if command -v claude &> /dev/null; then
        AGENT_CMD="claude"
    elif command -v amp &> /dev/null; then
        AGENT_CMD="amp"
    else
        echo "Error: Neither 'claude' nor 'amp' CLI tools found."
        exit 1
    fi

    echo "Running agent..."
    $AGENT_CMD -p "$PROMPT" --print > .ralph_last_output.txt
    
    cat .ralph_last_output.txt
    
    if grep -q "promise completed" .ralph_last_output.txt; then
        echo "🎉 All tasks completed! Ralph is finished."
        break
    fi
    
    echo "Iteration $i finished. Checking for next task..."
done
EOF

chmod +x plans/ralph.sh

# Create ralph-once.sh (Human in the loop)
echo "Creating plans/ralph-once.sh..."
cat > plans/ralph-once.sh <<'EOF'
#!/bin/bash
# Just run one iteration for human-in-the-loop
./plans/ralph.sh 1
EOF
chmod +x plans/ralph-once.sh

echo "✅ Ralph Wiggum setup complete in plans/"
echo "To start: ./plans/ralph.sh 5"
