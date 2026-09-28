# AKKU Car Wash CRM

This is a car wash management app I built to keep the daily workflow in one place: checking in cars, following each wash stage, looking up customer history, and handling bookings.

The interface is available in English and Russian. A demo mode lets visitors try it with sample data.

## What it does

- Tracks cars from arrival through washing, drying, ready for pickup, parking, and archive.
- Shows timers for arrival and washing. Staff can move a car to the next stage early.
- Keeps customer and vehicle details together, with search by plate number, name, or phone.
- Accepts online bookings and Telegram booking requests.
- Sends customers Telegram updates when a car's status changes, after they connect their account and confirm their phone number.
- Separates staff and administrator access. Some actions, such as reviewing archive deletion requests, are administrator-only.
- Opens a pre-filled WhatsApp message for staff to send manually. WhatsApp messages are not sent automatically.
- Lets visitors explore the interface in demo mode. Demo changes use sample data in the browser and are not saved to the live database.

## Built with

Node.js, Express, Supabase, JavaScript, HTML, CSS, and the Telegram Bot API.

## Run locally

You will need Node.js 20 or later and a Supabase project.

1. Run `database.sql` in the Supabase SQL Editor.
2. Copy `.env.example` to `.env` and add your Supabase URL and service role key.
3. Set separate `STAFF_PASSWORD` and `ADMIN_PASSWORD` values.
4. To enable Telegram, add `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and a random `WEBHOOK_SECRET`.
5. Install dependencies and start the app:

   ```sh
   npm ci
   npm start
   ```

6. Open `http://localhost:3000`.

Keep `.env` private. Do not commit passwords, Supabase service keys, or Telegram tokens to GitHub.

## Deploy

The repository includes a `render.yaml` blueprint for deploying the Node.js service on Render. Add the required environment variables in the Render service settings before using the app. GitHub Pages cannot run the Express server or connect to Supabase, so it is not a deployment option for this project.

After deployment, set the Telegram webhook to the public Render service URL:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<PUBLIC_RENDER_URL>/api/telegram/webhook&secret_token=<WEBHOOK_SECRET>
```

For an existing Supabase database, you can run the updated `database.sql` again to apply the safe schema updates.

## Telegram bookings and reminders

Customers can submit booking requests through the Telegram bot or use the online booking form at `/booking.html`. Staff can review Telegram requests in the app. Once a customer connects the bot and confirms the phone number used for the booking, the bot can send status updates.

The optional reminder function is in `supabase/functions/remind-bookings`. It needs to be deployed and configured in Supabase before scheduled reminders will run.

## Notes

The demo is for trying the interface, not for entering real customer information. Availability and background jobs depend on the Render and Supabase plans configured for the deployment.
