import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const NARRATIVE_TEMPLATE_SCHEMA = "narrative_template_v1";
export const NARRATIVE_SIGNALS_SCHEMA = "narrative_signals_v1";
export const NARRATIVE_PROFILE_SCHEMA = "narrative_profile_v1";

const ENUMS = {
  pov_person: ["first", "second", "third_limited", "third_omniscient", "mixed", "unclear"],
  pov_tense: ["past", "present", "mixed", "unclear"],
  introduced_via: ["external_description", "in_action", "in_dialogue", "inner_thought", "reported", "prior_section", "unclear"],
  emotion_expression: ["explicit_label", "embodied_metaphor", "behavioral_cue", "dialogue", "ambiguous"],
  event_link: ["caused_by_prior", "coincidence", "external_interruption", "setup", "parallel"],
  causal_continuity: ["single_unbroken", "mostly_linear", "branching", "fragmented", "not_applicable"],
  subplot_relation: ["none", "thematically_parallel", "contrasting", "independent"],
  temporal_order: ["linear", "mostly_linear", "nonlinear"],
  temporal_device: ["flashback", "flash_forward", "time_jump", "summary_leap", "recontextualization"],
  resolution_mode: ["external_action", "internal_understanding", "mixed", "unresolved"],
  resolution_agency: ["protagonist_choice", "mixed", "external_fate"],
  mirror: ["none", "occasional", "pervasive"],
  sensory_emphasis: ["visual", "auditory", "olfactory", "tactile", "gustatory", "kinesthetic"],
  sensory_density: ["minimal", "moderate", "lush"],
  thematic_commentary: ["none", "implicit", "occasional_explicit", "frequent_explicit"],
  moral_stance: ["ambivalent", "clear", "none"],
  dialogue_proportion: ["none", "sparse", "balanced", "heavy"],
  dialogue_function: ["advance_plot", "reveal_character", "worldbuilding", "philosophical_debate", "comic"],
  reference_explicitness: ["named", "implicit_echo"],
};

const EVIDENCE_SLOTS = [
  "emotion_embodied",
  "setting_mirror",
  "thematic_commentary",
  "philosophical_dialogue",
  "recontextualization",
];

export function normalizeNarrativeTemplate(raw) {
  const warnings = [];
  const source = raw && typeof raw === "object" ? raw : {};
  const pick = (value, options, fallback, label) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (options.includes(normalized)) return normalized;
    if (normalized) warnings.push(`${label}: "${normalized}" is not a known value; recorded as ${fallback}`);
    return fallback;
  };
  const pickList = (value, options, label) => {
    if (!Array.isArray(value)) return [];
    const kept = [];
    for (const item of value) {
      const normalized = String(item ?? "").trim().toLowerCase();
      if (options.includes(normalized)) {
        if (!kept.includes(normalized)) kept.push(normalized);
      } else if (normalized) {
        warnings.push(`${label}: dropped unknown value "${normalized}"`);
      }
    }
    return kept;
  };
  const stringList = (value) =>
    Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  const bool = (value, fallback = false) => (typeof value === "boolean" ? value : fallback);

  const template = {
    pov: {
      person: pick(source.pov?.person, ENUMS.pov_person, "unclear", "pov.person"),
      tense: pick(source.pov?.tense, ENUMS.pov_tense, "unclear", "pov.tense"),
    },
    agents: (Array.isArray(source.agents) ? source.agents : []).map((agent, index) => ({
      name: String(agent?.name ?? "").trim() || `agent_${index + 1}`,
      role: String(agent?.role ?? "").trim(),
      introduced_via: pick(agent?.introduced_via, ENUMS.introduced_via, "unclear", `agents[${index}].introduced_via`),
      emotion_expression: pickList(agent?.emotion_expression, ENUMS.emotion_expression, `agents[${index}].emotion_expression`),
      trajectory: String(agent?.trajectory ?? "").trim(),
    })),
    events: (Array.isArray(source.events) ? source.events : []).map((event, index) => ({
      summary: String(event?.summary ?? "").trim(),
      link: pick(event?.link, ENUMS.event_link, "caused_by_prior", `events[${index}].link`),
      turn: bool(event?.turn),
    })),
    causal_chain: {
      continuity: pick(source.causal_chain?.continuity, ENUMS.causal_continuity, "not_applicable", "causal_chain.continuity"),
      loose_ends: stringList(source.causal_chain?.loose_ends),
    },
    subplots: {
      present: bool(source.subplots?.present),
      relation: pick(source.subplots?.relation, ENUMS.subplot_relation, "none", "subplots.relation"),
    },
    temporal: {
      order: pick(source.temporal?.order, ENUMS.temporal_order, "linear", "temporal.order"),
      devices: pickList(source.temporal?.devices, ENUMS.temporal_device, "temporal.devices"),
      span: String(source.temporal?.span ?? "").trim(),
    },
    revelation: {
      withheld: stringList(source.revelation?.withheld),
      questions_planted: stringList(source.revelation?.questions_planted),
      revealed: (Array.isArray(source.revelation?.revealed) ? source.revelation.revealed : []).map((item) => ({
        what: String(item?.what ?? "").trim(),
        recontextualizes_earlier: bool(item?.recontextualizes_earlier),
      })),
    },
    resolution: {
      present: bool(source.resolution?.present),
      mode: pick(source.resolution?.mode, ENUMS.resolution_mode, "unresolved", "resolution.mode"),
      agency: pick(source.resolution?.agency, ENUMS.resolution_agency, "mixed", "resolution.agency"),
    },
    setting: {
      locations: stringList(source.setting?.locations),
      mirrors_interior_state: pick(source.setting?.mirrors_interior_state, ENUMS.mirror, "none", "setting.mirrors_interior_state"),
      sensory_emphasis: pickList(source.setting?.sensory_emphasis, ENUMS.sensory_emphasis, "setting.sensory_emphasis"),
      sensory_density: pick(source.setting?.sensory_density, ENUMS.sensory_density, "moderate", "setting.sensory_density"),
    },
    narration: {
      thematic_commentary: pick(source.narration?.thematic_commentary, ENUMS.thematic_commentary, "none", "narration.thematic_commentary"),
      themes_stated_verbatim: stringList(source.narration?.themes_stated_verbatim),
      addresses_reader: bool(source.narration?.addresses_reader),
      moral_stance: pick(source.narration?.moral_stance, ENUMS.moral_stance, "none", "narration.moral_stance"),
    },
    dialogue: {
      proportion: pick(source.dialogue?.proportion, ENUMS.dialogue_proportion, "none", "dialogue.proportion"),
      functions: pickList(source.dialogue?.functions, ENUMS.dialogue_function, "dialogue.functions"),
    },
    intertext: {
      references: (Array.isArray(source.intertext?.references) ? source.intertext.references : []).map((item, index) => ({
        target: String(item?.target ?? "").trim(),
        explicitness: pick(item?.explicitness, ENUMS.reference_explicitness, "implicit_echo", `intertext.references[${index}].explicitness`),
      })).filter((item) => item.target),
    },
    evidence: {},
  };

  for (const slot of EVIDENCE_SLOTS) {
    template.evidence[slot] = stringList(source.evidence?.[slot]).slice(0, 3);
  }

  return { template, warnings };
}

export function sectionBodySha(sectionText) {
  const body = String(sectionText ?? "").replace(/^\s*<!--[\s\S]*?-->/, "").trim();
  return crypto.createHash("sha256").update(body).digest("hex");
}

// Freshness must be recomputed from the current section text at read time —
// a stored stale flag only says what was true when the artifact was written.
export function isTemplateStale(templateArtifact, sectionText) {
  if (!templateArtifact || templateArtifact.schema !== NARRATIVE_TEMPLATE_SCHEMA) return true;
  if (!templateArtifact.section_sha256) return true;
  return templateArtifact.section_sha256 !== sectionBodySha(sectionText);
}

export function narrativeFeatureSetSha(features) {
  return crypto.createHash("sha256").update(JSON.stringify(Array.isArray(features) ? features : [])).digest("hex");
}

export function narrativeTemplateSha(templateArtifact) {
  if (!templateArtifact || templateArtifact.schema !== NARRATIVE_TEMPLATE_SCHEMA) return "";
  const source = {
    section_sha256: templateArtifact.section_sha256 ?? "",
    prompt_sha256: templateArtifact.prompt_sha256 ?? "",
    model: templateArtifact.model ?? "",
    template: templateArtifact.template ?? null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

// A current template is not enough to make derived observations current. If a
// section was re-extracted but `features` was not rerun, the signals still
// describe the previous template. Kind and feature-definition changes also
// invalidate the derived artifact even when the section body is unchanged.
export function narrativeSignalStaleness({
  signalsArtifact,
  templateArtifact,
  sectionText,
  kind = "",
  featuresSha256 = "",
}) {
  const reasons = [];
  if (!signalsArtifact || signalsArtifact.schema !== NARRATIVE_SIGNALS_SCHEMA) {
    return { stale: true, reasons: ["signals artifact is missing or has an unknown schema"] };
  }
  if (!signalsArtifact.features || typeof signalsArtifact.features !== "object" || Array.isArray(signalsArtifact.features)) {
    reasons.push("signals artifact has no readable feature observations");
  }
  if (!templateArtifact || templateArtifact.schema !== NARRATIVE_TEMPLATE_SCHEMA || !templateArtifact.section_sha256) {
    reasons.push("template artifact is missing or has an unknown schema");
  } else {
    if (isTemplateStale(templateArtifact, sectionText)) {
      reasons.push("section body changed since template extraction");
    }
    if (!signalsArtifact.template_section_sha256) {
      reasons.push("signals artifact does not record its template hash");
    } else if (signalsArtifact.template_section_sha256 !== templateArtifact.section_sha256) {
      reasons.push("template changed since feature derivation");
    }
    const currentTemplateSha = narrativeTemplateSha(templateArtifact);
    if (!signalsArtifact.template_sha256) {
      reasons.push("signals artifact does not record its template artifact hash");
    } else if (signalsArtifact.template_sha256 !== currentTemplateSha) {
      reasons.push("template artifact changed since feature derivation");
    }
  }
  if (String(signalsArtifact.kind ?? "").trim() !== String(kind ?? "").trim()) {
    reasons.push("section kind changed since feature derivation");
  }
  if (featuresSha256) {
    if (!signalsArtifact.features_sha256) {
      reasons.push("signals artifact does not record its feature-definition hash");
    } else if (signalsArtifact.features_sha256 !== featuresSha256) {
      reasons.push("narrative feature definitions changed since feature derivation");
    }
  }
  return { stale: reasons.length > 0, reasons };
}

// Quotes that cannot be located verbatim (or after whitespace collapsing) in
// the section body are dropped, mirroring the review runner's no-quote-no-issue
// rule. The dropped list is preserved so extraction quality stays visible.
export function verifyTemplateEvidence(template, sectionBody) {
  const body = String(sectionBody ?? "");
  const collapsedBody = collapseWhitespace(body);
  const dropped = [];
  let verified = 0;

  const verifyList = (quotes, slot) => {
    const kept = [];
    for (const quote of quotes) {
      if (body.includes(quote) || collapsedBody.includes(collapseWhitespace(quote))) {
        kept.push(quote);
        verified += 1;
      } else {
        dropped.push({ slot, quote });
      }
    }
    return kept;
  };

  const next = structuredClone(template);
  for (const slot of EVIDENCE_SLOTS) {
    next.evidence[slot] = verifyList(next.evidence[slot] ?? [], `evidence.${slot}`);
  }
  next.narration.themes_stated_verbatim = verifyList(
    next.narration.themes_stated_verbatim ?? [],
    "narration.themes_stated_verbatim",
  );

  return { template: next, verification: { verified, dropped } };
}

export function loadNarrativeFeatures(packageRoot, projectRoot) {
  const warnings = [];
  const packaged = readFeaturesFile(path.join(packageRoot, "narrative/features.json"), warnings);
  if (!packaged) {
    return {
      features: [],
      sha256: narrativeFeatureSetSha([]),
      template_prompt: "narrative/prompts/template-extract.md",
      default_model: "qwen/qwen3.7-plus",
      source: "missing",
      warnings: [...warnings, "packaged narrative/features.json not found"],
    };
  }

  let source = "package defaults";
  const merged = new Map(packaged.features.map((feature) => [feature.id, feature]));
  if (projectRoot && path.resolve(projectRoot) !== path.resolve(packageRoot)) {
    const override = readFeaturesFile(path.join(projectRoot, "narrative/features.json"), warnings);
    if (override) {
      source = "package defaults + project narrative/features.json";
      for (const feature of override.features) {
        if (!feature?.id) {
          warnings.push("ignored project feature entry without id");
          continue;
        }
        if (feature.disabled === true) {
          merged.delete(feature.id);
          continue;
        }
        merged.set(feature.id, { ...(merged.get(feature.id) ?? {}), ...feature });
      }
    }
  }

  const features = [];
  for (const feature of merged.values()) {
    if (!DERIVERS[feature.id]) {
      warnings.push(`feature ${feature.id}: no deriver implemented; skipped`);
      continue;
    }
    features.push(feature);
  }

  return {
    features,
    sha256: narrativeFeatureSetSha(features),
    template_prompt: packaged.template_prompt ?? "narrative/prompts/template-extract.md",
    default_model: packaged.default_model ?? "qwen/qwen3.7-plus",
    source,
    warnings,
  };
}

function readFeaturesFile(file, warnings) {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...parsed, features: Array.isArray(parsed.features) ? parsed.features : [] };
  } catch (error) {
    warnings.push(`${file}: invalid JSON (${error.message})`);
    return null;
  }
}

export function featureAppliesToKind(feature, kind) {
  const patterns = Array.isArray(feature.applies_to) && feature.applies_to.length ? feature.applies_to : ["*"];
  if (patterns.includes("*")) return true;
  if (!kind) return false;
  return patterns.some((pattern) => {
    if (pattern === kind) return true;
    if (pattern.endsWith(".*")) return kind.startsWith(pattern.slice(0, -1));
    return false;
  });
}

const DERIVERS = {
  thematic_explicitness(template) {
    const commentary = template.narration.thematic_commentary;
    const stated = template.narration.themes_stated_verbatim.length;
    let value;
    if (stated > 1 || commentary === "frequent_explicit") value = "stated_repeatedly";
    else if (stated === 1 || commentary === "occasional_explicit") value = "stated_once";
    else value = commentary === "implicit" ? "implicit" : "none";
    return {
      value,
      evidence: [...template.narration.themes_stated_verbatim, ...template.evidence.thematic_commentary].slice(0, 3),
    };
  },
  narrator_thematic_commentary(template) {
    const explicit = ["occasional_explicit", "frequent_explicit"].includes(template.narration.thematic_commentary);
    return { value: explicit ? "yes" : "no", evidence: template.evidence.thematic_commentary.slice(0, 3) };
  },
  philosophical_dialogue(template) {
    const present = template.dialogue.functions.includes("philosophical_debate");
    return { value: present ? "yes" : "no", evidence: template.evidence.philosophical_dialogue.slice(0, 3) };
  },
  moral_stance(template) {
    return { value: template.narration.moral_stance };
  },
  emotion_expression_mode(template) {
    const counts = new Map();
    for (const agent of template.agents) {
      for (const mode of agent.emotion_expression) {
        if (mode === "ambiguous") continue;
        counts.set(mode, (counts.get(mode) ?? 0) + 1);
      }
    }
    if (!counts.size) return { value: "ambiguous" };
    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    const value = ranked.length > 1 && ranked[0][1] === ranked[1][1] ? "mixed" : ranked[0][0];
    const evidence = value === "embodied_metaphor" ? template.evidence.emotion_embodied.slice(0, 3) : [];
    return { value, evidence };
  },
  setting_as_psychological_mirror(template) {
    return { value: template.setting.mirrors_interior_state, evidence: template.evidence.setting_mirror.slice(0, 3) };
  },
  sensory_density(template) {
    return { value: template.setting.sensory_density };
  },
  olfactory_emphasis(template) {
    return { value: template.setting.sensory_emphasis.includes("olfactory") ? "yes" : "no" };
  },
  character_introduction_mode(template) {
    const counts = new Map();
    for (const agent of template.agents) {
      if (["prior_section", "unclear"].includes(agent.introduced_via)) continue;
      counts.set(agent.introduced_via, (counts.get(agent.introduced_via) ?? 0) + 1);
    }
    if (!counts.size) return { value: null, not_applicable: true, reason: "no newly introduced characters" };
    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    return { value: ranked[0][0] };
  },
  causal_continuity(template) {
    if (template.causal_chain.continuity === "not_applicable") {
      return { value: null, not_applicable: true, reason: "no causal chain reported" };
    }
    return { value: template.causal_chain.continuity };
  },
  subplot_presence(template) {
    if (!template.subplots.present) return { value: "none" };
    const relation = template.subplots.relation;
    return { value: relation === "none" ? "independent" : relation };
  },
  resolution_mode(template) {
    if (!template.resolution.present) return { value: "unresolved" };
    return { value: template.resolution.mode };
  },
  resolution_agency(template) {
    if (!template.resolution.present) return { value: null, not_applicable: true, reason: "section does not resolve" };
    return { value: template.resolution.agency };
  },
  scene_turn_present(template) {
    return { value: template.events.some((event) => event.turn) ? "yes" : "no" };
  },
  loose_ends_present(template) {
    return { value: template.causal_chain.loose_ends.length ? "yes" : "no" };
  },
  temporal_order(template) {
    return { value: template.temporal.order };
  },
  anachrony_devices(template) {
    const count = template.temporal.devices.length;
    return { value: count === 0 ? "none" : count === 1 ? "single" : "multiple" };
  },
  recontextualization(template) {
    const present = template.revelation.revealed.some((item) => item.recontextualizes_earlier);
    return { value: present ? "yes" : "no", evidence: template.evidence.recontextualization.slice(0, 3) };
  },
  reader_address(template) {
    return { value: template.narration.addresses_reader ? "yes" : "no" };
  },
  location_variety(template) {
    const count = template.setting.locations.length;
    return { value: count <= 1 ? "single" : count <= 3 ? "couple" : "many" };
  },
  dialogue_proportion(template) {
    return { value: template.dialogue.proportion };
  },
  intertext_explicitness(template) {
    const references = template.intertext.references;
    if (!references.length) return { value: "none" };
    return { value: references.some((item) => item.explicitness === "named") ? "named_present" : "implicit_only" };
  },
};

export function deriveNarrativeFeatures(template, { kind = "", features = [] } = {}) {
  const derived = {};
  const skipped = [];
  for (const feature of features) {
    if (!featureAppliesToKind(feature, kind)) {
      skipped.push({ id: feature.id, reason: `does not apply to kind "${kind || "(none)"}"` });
      continue;
    }
    const deriver = DERIVERS[feature.id];
    const result = deriver(template);
    derived[feature.id] = {
      label: feature.label ?? feature.id,
      dimension: feature.dimension ?? "",
      type: feature.type ?? "categorical",
      value: result.value ?? null,
      not_applicable: result.not_applicable === true,
      ...(result.reason ? { reason: result.reason } : {}),
      evidence: result.evidence ?? [],
      ai_lean: feature.ai_lean ?? null,
      human_lean: feature.human_lean ?? null,
    };
  }
  return { features: derived, skipped };
}

export const NARRATIVE_INTENTS = {
  narrative_resolution: {
    feature: "resolution_mode",
    values: ["external_action", "internal_understanding", "mixed", "unresolved"],
    matches: (declared, observed) => declared === observed,
  },
  narrative_agency: {
    feature: "resolution_agency",
    values: ["protagonist_choice", "mixed", "external_fate"],
    matches: (declared, observed) => declared === observed,
  },
  narrative_emotion: {
    feature: "emotion_expression_mode",
    values: ["explicit_label", "embodied_metaphor", "behavioral_cue", "dialogue", "mixed"],
    matches: (declared, observed) => declared === observed || (declared === "mixed" && observed === "ambiguous"),
  },
  narrative_commentary: {
    feature: "thematic_explicitness",
    values: ["none", "implicit", "explicit"],
    matches: (declared, observed) => {
      if (declared === "none") return observed === "none";
      if (declared === "implicit") return observed === "none" || observed === "implicit";
      return observed === "stated_once" || observed === "stated_repeatedly";
    },
  },
  narrative_time: {
    feature: "temporal_order",
    values: ["linear", "mostly_linear", "nonlinear"],
    matches: (declared, observed) => declared === observed,
  },
  narrative_subplots: {
    feature: "subplot_presence",
    values: ["none", "thematically_parallel", "contrasting", "independent"],
    matches: (declared, observed) => declared === observed,
  },
  narrative_reader_address: {
    feature: "reader_address",
    values: ["yes", "no"],
    matches: (declared, observed) => declared === observed,
  },
};

const INTENT_GUIDANCE = {
  narrative_resolution: {
    external_action: "resolve this section's tension through action taken in the world, not a realization",
    internal_understanding: "resolve this section's tension through an internal shift or realization",
    mixed: "resolve this section's tension through action and realization together",
    unresolved: "leave this section's tension deliberately open; do not manufacture closure",
  },
  narrative_agency: {
    protagonist_choice: "let the protagonist's own choice drive the outcome",
    mixed: "let choice and outside forces share the outcome",
    external_fate: "let outside forces drive the outcome; the protagonist does not steer it",
  },
  narrative_emotion: {
    explicit_label: "convey emotion primarily by naming it plainly, not through body metaphors",
    embodied_metaphor: "convey emotion primarily through body and sensation",
    behavioral_cue: "convey emotion primarily through outward behavior and action",
    dialogue: "convey emotion primarily through what characters say",
    mixed: "vary how emotion is conveyed; no single mode should dominate",
  },
  narrative_commentary: {
    none: "dramatize meaning; the narration must not state the theme or moral",
    implicit: "keep the theme implicit; no narratorial summing-up after scenes",
    explicit: "an explicit thematic statement is a chosen device in this section",
  },
  narrative_time: {
    linear: "arrange events strictly forward in time",
    mostly_linear: "move mostly forward in time, with brief deliberate departures",
    nonlinear: "use nonlinear order: flashback, jump, or delayed disclosure is wanted here",
  },
  narrative_subplots: {
    none: "keep a single narrative track; no subplots",
    thematically_parallel: "carry a secondary thread that echoes the central theme",
    contrasting: "carry a secondary thread that pushes against the central theme",
    independent: "carry an independent secondary thread",
  },
  narrative_reader_address: {
    yes: "the narrator may address the reader directly",
    no: "no direct reader address",
  },
};

export function describeNarrativeIntent(key, value) {
  return INTENT_GUIDANCE[key]?.[value] ?? `${key} = ${value}`;
}

export function parseNarrativeIntents(contractFields) {
  const intents = {};
  const warnings = [];
  if (!contractFields) return { intents, warnings };
  const get = typeof contractFields.get === "function" ? (key) => contractFields.get(key) : (key) => contractFields[key];
  for (const [key, spec] of Object.entries(NARRATIVE_INTENTS)) {
    const raw = get(key);
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = String(raw).trim().toLowerCase();
    if (!spec.values.includes(value)) {
      warnings.push(`${key}: unknown value "${value}" (expected one of: ${spec.values.join(", ")})`);
      continue;
    }
    intents[key] = value;
  }
  return { intents, warnings };
}

export function checkIntentsAgainstFeatures(intents, features) {
  const results = [];
  for (const [key, declared] of Object.entries(intents)) {
    const spec = NARRATIVE_INTENTS[key];
    if (!spec) continue;
    const observation = features[spec.feature];
    if (!observation || observation.not_applicable || observation.value === null) {
      results.push({ intent: key, feature: spec.feature, declared, observed: null, match: null, note: "no observation" });
      continue;
    }
    results.push({
      intent: key,
      feature: spec.feature,
      declared,
      observed: observation.value,
      match: spec.matches(declared, observation.value),
    });
  }
  return results;
}

export function aggregateNarrativeProfile(entries, { featureSet = [] } = {}) {
  const ordered = [...entries].sort((left, right) => left.order_index - right.order_index);
  const featureMeta = new Map(featureSet.map((feature) => [feature.id, feature]));
  const featureIds = new Set();
  for (const entry of ordered) {
    for (const id of Object.keys(entry.features ?? {})) featureIds.add(id);
  }

  const features = {};
  const convergenceFlags = [];
  for (const id of featureIds) {
    const values = {};
    const distribution = {};
    let observed = 0;
    let notApplicable = 0;
    const sequence = [];
    // A run must break on any gap: a section where the feature was skipped or
    // not applicable, and any hole in the draft order (a section with no
    // observations at all sits between two entries as an order_index jump).
    let lastIndex = null;
    for (const entry of ordered) {
      if (lastIndex !== null && entry.order_index > lastIndex + 1) sequence.push(null);
      lastIndex = entry.order_index;
      const observation = entry.features?.[id];
      if (!observation) {
        sequence.push(null);
        continue;
      }
      if (observation.not_applicable || observation.value === null) {
        notApplicable += 1;
        sequence.push(null);
        continue;
      }
      values[entry.section_id] = observation.value;
      distribution[observation.value] = (distribution[observation.value] ?? 0) + 1;
      observed += 1;
      sequence.push(observation.value);
    }

    let dominant = null;
    let dominantCount = 0;
    for (const [value, count] of Object.entries(distribution)) {
      if (count > dominantCount) {
        dominant = value;
        dominantCount = count;
      }
    }
    const share = observed ? Number((dominantCount / observed).toFixed(2)) : 0;
    const longestRun = longestNonNullRun(sequence);
    const meta = featureMeta.get(id);
    const matchesAiLean = Boolean(meta?.ai_lean && dominant === meta.ai_lean);

    features[id] = {
      label: meta?.label ?? id,
      dimension: meta?.dimension ?? "",
      observed,
      not_applicable: notApplicable,
      values,
      distribution,
      dominant,
      dominant_share: share,
      longest_run: longestRun.length,
      longest_run_value: longestRun.value,
      matches_ai_lean: matchesAiLean,
    };

    const reasons = [];
    if (observed >= 4 && share >= 0.7 && dominant !== null) {
      reasons.push(`${Math.round(share * 100)}% of ${observed} observed sections share "${dominant}"`);
    }
    if (longestRun.length >= 3 && longestRun.value !== null) {
      reasons.push(`${longestRun.length} consecutive sections use "${longestRun.value}"`);
    }
    if (reasons.length) {
      convergenceFlags.push({
        feature: id,
        label: meta?.label ?? id,
        dominant,
        dominant_share: share,
        longest_run: longestRun.length,
        matches_ai_lean: matchesAiLean,
        reasons,
        note: matchesAiLean
          ? "Convergence direction matches the common model default; vary it only if the repetition is unchosen."
          : "Convergence may be a deliberate motif; flagging repetition, not error.",
      });
    }
  }

  const intentDrift = [];
  for (const entry of ordered) {
    for (const check of entry.intent_check ?? []) {
      if (check.match === false) {
        intentDrift.push({
          section_id: entry.section_id,
          intent: check.intent,
          feature: check.feature,
          declared: check.declared,
          observed: check.observed,
        });
      }
    }
  }

  return {
    sections: ordered.map((entry) => entry.section_id),
    features,
    convergence_flags: convergenceFlags.sort((left, right) => right.dominant_share - left.dominant_share),
    intent_drift: intentDrift,
  };
}

const DIFF_AXES = [
  ["resolution", (template) => (template.resolution.present ? template.resolution.mode : "unresolved")],
  ["resolution agency", (template) => (template.resolution.present ? template.resolution.agency : "n/a")],
  ["temporal order", (template) => template.temporal.order],
  ["time devices", (template) => [...template.temporal.devices].sort().join("+") || "none"],
  ["causal continuity", (template) => template.causal_chain.continuity],
  ["loose ends", (template) => (template.causal_chain.loose_ends.length ? "open" : "closed")],
  ["subplots", (template) => (template.subplots.present ? template.subplots.relation : "none")],
  ["thematic commentary", (template) => template.narration.thematic_commentary],
  ["moral stance", (template) => template.narration.moral_stance],
  ["reader address", (template) => String(template.narration.addresses_reader)],
  ["emotion modes", (template) => {
    const modes = new Set();
    for (const agent of template.agents) for (const mode of agent.emotion_expression) modes.add(mode);
    return [...modes].sort().join("+") || "none";
  }],
  ["setting mirror", (template) => template.setting.mirrors_interior_state],
  ["sensory density", (template) => template.setting.sensory_density],
  ["dialogue proportion", (template) => template.dialogue.proportion],
  ["scene turns", (template) => String(template.events.filter((event) => event.turn).length)],
  ["location spread", (template) => {
    const count = template.setting.locations.length;
    return count <= 1 ? "single" : count <= 3 ? "couple" : "many";
  }],
];

// Compares two templates on fixed structural axes to answer "did this
// candidate make different narrative choices, or the same choices in
// different words?" — word-level rewrites share nearly every axis.
export function diffNarrativeTemplates(templateA, templateB) {
  const axes = DIFF_AXES.map(([axis, read]) => {
    const a = read(templateA);
    const b = read(templateB);
    return { axis, a, b, same: a === b };
  });
  const distinct = axes.filter((row) => !row.same).length;
  const verdict =
    distinct <= 2
      ? "word-level variants of the same narrative choices"
      : distinct <= 5
        ? "moderately distinct narrative choices"
        : "structurally distinct narrative choices";
  return { axes, distinct_count: distinct, total_axes: axes.length, verdict };
}

function longestNonNullRun(sequence) {
  let best = { value: null, length: 0 };
  let currentValue = null;
  let currentLength = 0;
  for (const value of sequence) {
    if (value !== null && value === currentValue) {
      currentLength += 1;
    } else {
      currentValue = value;
      currentLength = value === null ? 0 : 1;
    }
    if (currentLength > best.length) best = { value: currentValue, length: currentLength };
  }
  return best;
}

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
