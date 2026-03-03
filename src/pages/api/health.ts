import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  return new Response(JSON.stringify({ status: 'healthy' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
