import type { CloudflareEnv } from './env';

export { ReservationSchedulerDO } from './scheduler-do';

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);

    // Enforce HTTPS in production Cloudflare deployments
    if (
      url.protocol === 'http:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/api/')) {
      if (env.PANEL_ACCESS_TOKEN) {
        const authHeader = request.headers.get('Authorization') || '';
        const tokenHeader = request.headers.get('X-Panel-Token') || '';
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (bearer !== env.PANEL_ACCESS_TOKEN && tokenHeader !== env.PANEL_ACCESS_TOKEN) {
          return Response.json(
            { error: 'توکن دسترسی پنل نامعتبر است.' },
            { status: 401 }
          );
        }
      }

      const id = env.SCHEDULER_DO.idFromName('primary-iut-user');
      const stub = env.SCHEDULER_DO.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
