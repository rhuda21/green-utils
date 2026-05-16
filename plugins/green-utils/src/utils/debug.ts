const WEBHOOK_URL = "https://discord.com/api/webhooks/1462543799829004430/I5OYC4e6lk5CNqmXcYDaBM2WX1wls9DZHGd5a6ZPZVlb-p3-F6KhqWCBZ5eV_AILdDZ-";

async function webhookLog(label: string, data: any) {
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**[Plugin Debug] ${label}**\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 1800)}\n\`\`\``
      })
    });
  } catch (e) {}
}
export { webhookLog };