import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async (req) => {
  const secret = Deno.env.get("REMINDER_SECRET");
  if (req.method !== "POST" || !secret || req.headers.get("x-reminder-secret") !== secret) return new Response("Unauthorized", { status: 401 });
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return Response.json({ error: "Telegram token is not configured" }, { status: 503 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date(), dayAhead = new Date(now.getTime() + 24 * 3600000), windowEnd = new Date(now.getTime() + 25 * 3600000);
  const localHour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Qyzylorda" }).format(now));
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const todayStart = new Date(localDate + "T00:00:00+05:00"), tomorrowStart = new Date(todayStart.getTime() + 86400000);
  const { data: orders, error } = await db.from("wash_orders").select("id,plate,service,scheduled_for,reminder_day_sent_at,reminder_today_sent_at,customers(telegram_chat_id)").eq("status", "booked").eq("voided", false).gte("scheduled_for", now.toISOString()).lte("scheduled_for", windowEnd.toISOString());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  for (const order of orders || []) {
    const chatId = order.customers?.telegram_chat_id, appointment = new Date(order.scheduled_for);
    const dayDue = appointment >= dayAhead && appointment <= windowEnd && !order.reminder_day_sent_at;
    const todayDue = appointment >= todayStart && appointment < tomorrowStart && localHour >= 9 && !order.reminder_today_sent_at;
    if (!chatId || (!dayDue && !todayDue)) continue;
    const when = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Qyzylorda", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(appointment);
    const text = (dayDue ? "🔔 Напоминание: завтра " : "☀️ Напоминание: сегодня ") + when + " ждём вас на мойке АККУ. Автомобиль " + order.plate + ", услуга: " + order.service + ".";
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) });
    const result = await response.json();
    if (!response.ok || !result.ok) { console.error("Telegram reminder failed", order.id, result.description); continue; }
    const column = dayDue ? "reminder_day_sent_at" : "reminder_today_sent_at";
    const saved = await db.from("wash_orders").update({ [column]: new Date().toISOString() }).eq("id", order.id).is(column, null);
    if (!saved.error) sent++;
  }
  return Response.json({ sent });
});