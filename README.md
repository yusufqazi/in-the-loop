# In The Loop
In the Loop is a meeting intelligence application that turns meeting transcripts into searchable, conversational knowledge. In this program, userse are able to upload or paste a transcript, select a meeting, and ask any questions about discussions, decisions, deadlines, and whatever other details from that meeting. There is also an option for voice-to-transcript, where the program also differentiates different speakers and allows the user to rename them.

## Quick Setup Instructions
# In The Loop

## Quick Setup Instructions

The easiest way to try In The Loop is through the live deployment:

**Live App:** [Vercel link here]

To run the project locally:

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/yusufqazi/in-the-loop.git
cd in-the-loop
npm ci
```

2. Copy `.env.example` to `.env.local` and provide the following environment variables:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

3. For a new Supabase project, run `supabase/schema.sql` in the Supabase SQL Editor and enable email/password authentication.

4. Start the application:

```bash
npm run dev
```

5. Open `http://127.0.0.1:3000`.