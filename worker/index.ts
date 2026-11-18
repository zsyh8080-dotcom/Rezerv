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
      const panelToken = env.PANEL_ACCESS_TOKEN || env.SETUP_KEY;
      if (!panelToken) {
        return Response.json({ error: 'کلید خصوصی PANEL_ACCESS_TOKEN یا SETUP_KEY را در Secrets میزبان تنظیم کنید.' }, { status: 503 });
      }
      if (panelToken) {
        const authHeader = request.headers.get('Authorization') || '';
        const tokenHeader = request.headers.get('X-Panel-Token') || '';
        const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (bearer !== panelToken && tokenHeader !== panelToken) {
          return Response.json(
            { error: 'توکن دسترسی پنل نامعتبر است.' },
            { status: 401 }
          );
        }
      }

      const id = env.SCHEDULER_DO.idFromName('primary-iut-user');
      const stub = env.SCHEDULER_DO.get(id);
      try {
        return await stub.fetch(request);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[نشانی سامانه]') : 'اجرای درخواست در سرور ناموفق بود.' }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
