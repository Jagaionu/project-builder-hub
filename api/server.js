// This file acts as the entry point for Vercel Serverless Functions
// It redirects requests to the TanStack Start server entry
export default async function handler(request, response) {
  // TanStack Start handles the request through the vite-built server entry
  // In a real deployment, Vercel will use the build output.
  // This file is a placeholder to ensure Vercel routes correctly if using custom server logic.
}
