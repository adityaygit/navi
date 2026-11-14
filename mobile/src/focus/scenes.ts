// Focus scenes, one per kind of space (M4-Focus). Generated gradients, no imagery.
export type Scene = { name: string; sky: string; sun: string; h1: string; h2: string; tint: string; soft: string; cta: string; stone: string; shadow: string };

export const scenes: Record<string, Scene> = {
  school: { name: "Dusk", sky: "linear-gradient(180deg, #2A2C6E 0%, #5652B0 22%, #A79BE6 40%, #F3B8D2 47%, #2A2350 52%, #120F26 100%)", sun: "rgba(255,214,230,0.55)", h1: "#2A2B63", h2: "#191A3E", tint: "#B9B2FF", soft: "#D9D5FF", cta: "linear-gradient(90deg, #C9C3FF, #FFC2DD)", stone: "radial-gradient(circle at 34% 28%, #F4F2FF 0%, #B9B2FF 32%, #4B3F9A 100%)", shadow: "rgba(160,150,255,0.5)" },
  work: { name: "Still water", sky: "linear-gradient(180deg, #0B3A46 0%, #1B6E78 22%, #5CC0B4 40%, #C8F2E2 47%, #0C3A40 52%, #04191C 100%)", sun: "rgba(200,255,240,0.45)", h1: "#0F3C42", h2: "#082629", tint: "#8EE6D6", soft: "#C6F5EA", cta: "linear-gradient(90deg, #D6F7A8, #8EE6D6)", stone: "radial-gradient(circle at 34% 28%, #F4FFF8 0%, #A7EBC0 30%, #2E7D63 100%)", shadow: "rgba(140,230,214,0.5)" },
  health: { name: "Sunrise", sky: "linear-gradient(180deg, #4A1E36 0%, #9A3F5A 22%, #F0907A 40%, #FFDDB8 47%, #4B2030 52%, #1C0B12 100%)", sun: "rgba(255,220,180,0.6)", h1: "#4E2233", h2: "#2E1220", tint: "#FFB59A", soft: "#FFD8C8", cta: "linear-gradient(90deg, #FFD3B0, #FFA9C6)", stone: "radial-gradient(circle at 34% 28%, #FFF6EE 0%, #FFC4A3 32%, #B65A5A 100%)", shadow: "rgba(255,150,130,0.5)" },
  hobby: { name: "Neon evening", sky: "linear-gradient(180deg, #33175A 0%, #6E3398 22%, #D27ACB 40%, #FFC6DE 47%, #34184F 52%, #150A22 100%)", sun: "rgba(255,190,230,0.5)", h1: "#3A1D5A", h2: "#200F33", tint: "#E3A6FF", soft: "#F0D2FF", cta: "linear-gradient(90deg, #E8B8FF, #FFB8D4)", stone: "radial-gradient(circle at 34% 28%, #FFF2FF 0%, #E3A6FF 32%, #7A3E9E 100%)", shadow: "rgba(220,150,255,0.5)" },
  friends: { name: "Golden hour", sky: "linear-gradient(180deg, #4A2C14 0%, #9A5A26 22%, #F0AE5C 40%, #FFE8B8 47%, #4A2C14 52%, #1C1008 100%)", sun: "rgba(255,230,170,0.6)", h1: "#4D3017", h2: "#2C1A0B", tint: "#FFD08A", soft: "#FFE6BF", cta: "linear-gradient(90deg, #FFE2A0, #FFB48A)", stone: "radial-gradient(circle at 34% 28%, #FFF8EA 0%, #FFD08A 32%, #A9663A 100%)", shadow: "rgba(255,200,120,0.5)" },
};

/** Pick a scene from a space's name ("School", "Hobbies", "Side job"…). */
export function sceneFor(spaceName: string | null | undefined): Scene {
  const n = (spaceName ?? "").toLowerCase();
  if (/work|job|shift|office/.test(n)) return scenes.work;
  if (/health|gym|run|fitness|sleep/.test(n)) return scenes.health;
  if (/hobb|music|art|guitar|game/.test(n)) return scenes.hobby;
  if (/friend|family|social|home/.test(n)) return scenes.friends;
  return scenes.school;
}
