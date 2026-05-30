export type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

export type TimeGreeting = {
  period: GreetingPeriod;
  label: string;
  emoji: string;
  briefingLabel: string;
  cardTitle: string;
};

export function getTimeGreeting(date = new Date()): TimeGreeting {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return {
      period: "morning",
      label: "Good morning",
      emoji: "☀️",
      briefingLabel: "Morning briefing",
      cardTitle: "Start your day sharper",
    };
  }

  if (hour >= 12 && hour < 17) {
    return {
      period: "afternoon",
      label: "Good afternoon",
      emoji: "🌤️",
      briefingLabel: "Afternoon briefing",
      cardTitle: "Stay sharp this afternoon",
    };
  }

  if (hour >= 17 && hour < 22) {
    return {
      period: "evening",
      label: "Good evening",
      emoji: "🌅",
      briefingLabel: "Evening briefing",
      cardTitle: "Wind down with clarity",
    };
  }

  return {
    period: "night",
    label: "Good night",
    emoji: "🌙",
    briefingLabel: "Tonight's briefing",
    cardTitle: "Catch up before tomorrow",
  };
}
