# Fyxer Calendar Integration

A calendar integration system that analyzes email messages and suggests meeting slots based on the user's calendar availability.

## Context

This project integrates with the user's Google Calendar. Calendar events are stored in the `calendarEvents` variable in `src/calendarEvents.ts`. The type definition for a `CalendarEvent` can be found in `src/types/CalendarEvent.ts`.

## Setup

### Prerequisites

- Node.js 22 or higher
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm i
# or
yarn
```

2. (Optional) Set up OpenAI API key for LLM-powered suggestions:
```bash
export OPENAI_API_KEY=your_api_key_here
```

If the API key is not set, the system will use deterministic fallback logic for meeting slot suggestions.

## Running the Project

### Development Mode

Run the main script:
```bash
npm run dev
# or
yarn dev
```

### Start Web Server

Start the Express server to access the web interface:
```bash
npm run server
# or
yarn server
```

It will run at `http://localhost:3000`

Check `package.json` for other available scripts