"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <h1>Something went wrong</h1>
      <p>The workspace could not load. Please try again.</p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
