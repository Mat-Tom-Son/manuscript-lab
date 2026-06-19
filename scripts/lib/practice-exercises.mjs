const EXERCISES = [
  {
    id: "want-in-room",
    title: "The Want In The Room",
    axis: "behavioral-desire",
    public_prompt: [
      "A character enters a space wanting something specific.",
      "Never state the want.",
      "Let behavior reveal it.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should be able to name what the character wants without the prose stating it. Fail if the want is named, invisible, or only inferable from exposition.",
  },
  {
    id: "thing-unsaid",
    title: "The Thing They Won't Say",
    axis: "withheld-subject",
    public_prompt: [
      "Write a scene where the most important thing remains unspoken.",
      "Let the missing subject create pressure.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should feel the pressure of the missing subject and be able to describe what is being withheld. Fail if nothing feels withheld or the scene names the central unsaid thing.",
  },
  {
    id: "limited-camera",
    title: "The Limited Camera",
    axis: "pov-filter",
    public_prompt: [
      "Describe a room using only what the point-of-view character would notice.",
      "Filter every detail through their mood, work, worry, or obsession.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should infer the character's mood or preoccupation from selected details alone. Fail if the description feels neutral, authorial, or explains the mood directly.",
  },
  {
    id: "object-biography",
    title: "Object As Biography",
    axis: "object-inference",
    public_prompt: [
      "Reveal a character entirely through objects in a bag, desk, fridge, locker, or room.",
      "Do not describe the character directly.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should infer a coherent, specific person from the objects alone. Fail if the objects feel generic, random, or require direct character explanation.",
  },
  {
    id: "subtext-argument",
    title: "The Subtext Argument",
    axis: "subtext-dialogue",
    public_prompt: [
      "Write two people arguing about one thing while really fighting about another.",
      "Never name the real subject.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should sense the real fight beneath the surface argument without it being named. Fail if only the surface argument exists or the subtext is stated.",
  },
  {
    id: "status-shift",
    title: "Status Shift In Plain Sight",
    axis: "power-turn",
    public_prompt: [
      "Write a scene where the power dynamic between two people changes.",
      "Keep the event ordinary and concrete.",
      "Do not explain who gained or lost power.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should be able to identify how the status relationship changed from behavior, gesture, timing, and response. Fail if the status shift is explained, absent, or only present as dialogue labels.",
  },
  {
    id: "contradictory-behavior",
    title: "The Body Disagrees",
    axis: "contradiction",
    public_prompt: [
      "Write a scene where a character says one thing but their body or choices reveal another.",
      "Do not state the contradiction.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should infer the gap between what the character says and what they actually feel or intend. Fail if the prose names the contradiction, hides it completely, or relies on inner explanation.",
  },
  {
    id: "escalation-without-exposition",
    title: "Escalation Without Explanation",
    axis: "scene-escalation",
    public_prompt: [
      "Write a scene that steadily escalates from mild discomfort to a clear breaking point.",
      "Use concrete actions and exchanged objects or tasks.",
      "Do not explain the stakes.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should feel the pressure rising and be able to point to the breaking point without being told the stakes. Fail if escalation is flat, summarized, or explained instead of enacted.",
  },
  {
    id: "relationship-through-action",
    title: "Relationship Through Action",
    axis: "relational-behavior",
    public_prompt: [
      "Write two characters doing a practical task together.",
      "Reveal their relationship only through how they share, avoid, correct, or interrupt the task.",
      "Do not describe the relationship directly.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should infer a specific relationship and its current tension from task behavior alone. Fail if the relationship is named, generic, or not visible in the task.",
  },
  {
    id: "ending-image-turn",
    title: "Ending Image That Turns The Scene",
    axis: "image-turn",
    public_prompt: [
      "Write a scene that ends on a concrete image which changes how the reader understands what came before.",
      "Do not explain the image's meaning.",
      "Write prose only.",
    ].join(" "),
    hidden_test: "A blind reader should feel the ending image reframe the scene without explanatory commentary. Fail if the image is decorative, opaque, or decoded by the narrator.",
  },
];

const EXERCISE_MAP = new Map(EXERCISES.map((exercise) => [exercise.id, exercise]));

export function listPracticeExercises() {
  return EXERCISES.map(cloneExercise);
}

export function practiceExerciseById(id) {
  const exercise = EXERCISE_MAP.get(String(id || "").trim());
  return exercise ? cloneExercise(exercise) : null;
}

export function practiceExerciseIds() {
  return EXERCISES.map((exercise) => exercise.id);
}

export function practiceExerciseSet(name) {
  const normalized = String(name || "core").trim().toLowerCase();
  if (normalized === "all" || normalized === "expanded") return listPracticeExercises();
  if (normalized === "core") return EXERCISES.slice(0, 5).map(cloneExercise);
  const ids = normalized.split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.length) return EXERCISES.slice(0, 5).map(cloneExercise);
  return ids.map((id) => practiceExerciseById(id)).filter(Boolean);
}

function cloneExercise(exercise) {
  return {
    id: exercise.id,
    title: exercise.title,
    axis: exercise.axis,
    public_prompt: exercise.public_prompt,
    hidden_test: exercise.hidden_test,
  };
}
