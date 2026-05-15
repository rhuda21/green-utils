const WEBHOOK_URL = "https://discord.com/api/webhooks/1504974604387618819/OrkukFrsKoVwkXVhyhxM_doNwtC0yWOJTcPWpnYxIBCuLmk7qRIQt41007_58Ta6fhQc";

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