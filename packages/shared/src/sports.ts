export const SPORTS = [
  "trail_run",
  "road_run",
  "hike",
  "mountaineering",
  "ski_touring",
  "nordic_ski",
  "alpine_ski",
  "bike",
  "swim",
  "paddle",
  "climbing",
  "team_sport",
  "strength",
  "mobility",
  "other",
] as const;
export type Sport = (typeof SPORTS)[number];

/** Sports a goal event (or one leg of a multisport event) can be in. */
export const GOAL_SPORTS = ["trail_run", "road_run", "hike", "mountaineering", "ski_touring", "bike", "swim", "paddle"] as const;
export type GoalSport = (typeof GOAL_SPORTS)[number];

/** Endurance sports that can carry training volume (as goal sport or cross-training). */
export const ENDURANCE_SPORTS = [
  "trail_run",
  "road_run",
  "hike",
  "mountaineering",
  "ski_touring",
  "nordic_ski",
  "bike",
  "swim",
  "paddle",
] as const;
export type EnduranceSport = (typeof ENDURANCE_SPORTS)[number];

/** Activities you do regularly on top of the plan (not prescribed by it). */
export const ACTIVITY_SPORTS = ["climbing", "team_sport", "swim", "bike", "alpine_ski", "mobility", "strength", "other"] as const;

/** Sports where climbing metres matter for the plan. */
export const VERTICAL_SPORTS: readonly Sport[] = ["trail_run", "hike", "mountaineering", "ski_touring"];

export const SPORT_LABELS: Record<Sport, string> = {
  trail_run: "Trail running",
  road_run: "Road running",
  hike: "Hiking / fastpacking",
  mountaineering: "Mountaineering",
  ski_touring: "Ski touring / skimo",
  nordic_ski: "Nordic skiing",
  alpine_ski: "Alpine skiing",
  bike: "Cycling",
  swim: "Swimming",
  paddle: "Paddling",
  climbing: "Climbing",
  team_sport: "Team sport",
  strength: "Strength",
  mobility: "Mobility",
  other: "Other",
};

export const SPORT_ICONS: Record<Sport, string> = {
  trail_run: "⛰️",
  road_run: "🏃",
  hike: "🥾",
  mountaineering: "🧗‍♂️",
  ski_touring: "🎿",
  nordic_ski: "⛷️",
  alpine_ski: "🏔️",
  bike: "🚴",
  swim: "🏊",
  paddle: "🛶",
  climbing: "🧗",
  team_sport: "⚽",
  strength: "🏋️",
  mobility: "🧘",
  other: "•",
};

/** Map Strava `sport_type` values onto our sports. */
export function sportFromStrava(sportType: string): Sport {
  switch (sportType) {
    case "TrailRun":
      return "trail_run";
    case "Run":
    case "VirtualRun":
      return "road_run";
    case "Hike":
    case "Walk":
      return "hike";
    case "BackcountrySki":
      return "ski_touring";
    case "NordicSki":
      return "nordic_ski";
    case "AlpineSki":
    case "Snowboard":
      return "alpine_ski";
    case "Ride":
    case "GravelRide":
    case "MountainBikeRide":
    case "VirtualRide":
    case "EBikeRide":
    case "EMountainBikeRide":
      return "bike";
    case "Swim":
      return "swim";
    case "Kayaking":
    case "Canoeing":
    case "StandUpPaddling":
    case "Rowing":
    case "VirtualRow":
      return "paddle";
    case "RockClimbing":
      return "climbing";
    case "Soccer":
    case "Basketball":
    case "Volleyball":
    case "Tennis":
    case "Squash":
    case "Badminton":
    case "Pickleball":
    case "Racquetball":
    case "TableTennis":
      return "team_sport";
    case "WeightTraining":
    case "Crossfit":
    case "Workout":
    case "HighIntensityIntervalTraining":
      return "strength";
    case "Yoga":
    case "Pilates":
      return "mobility";
    default:
      return "other";
  }
}
