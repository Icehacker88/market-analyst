export const onRequest = () => new Response(
  "google-site-verification: google5563d365987207e6.html\n",
  {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  },
);
