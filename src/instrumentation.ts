export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPrewarm } = await import("./lib/prewarm");
    startPrewarm();
  }
}
