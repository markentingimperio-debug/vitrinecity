import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../public/admin-agentes.html", import.meta.url), "utf8");
const startMarker = "      function viralProductionStatus(";
const endMarker = "\n      function renderViral()";
const start = html.indexOf(startMarker);
assert.notEqual(start, -1, "viralProductionStatus must be available for isolated testing");
const end = html.indexOf(endMarker, start);
assert.notEqual(end, -1, "renderViral must follow viralProductionStatus");
assert.equal(html.indexOf(startMarker, start + startMarker.length), -1, "only one status helper should exist");

// Evaluate only the pure helper: no page startup, network, provider, or production code.
const viralProductionStatus = vm.runInNewContext(
  `"use strict";\n${html.slice(start, end)}\nviralProductionStatus;`,
  Object.create(null),
  { timeout: 1000 },
);

const privateError = "PRIVATE_PROVIDER_ERROR_09: https://provider.invalid/job/private";
const privatePrompt = "PRIVATE_PROMPT_09";
const privateUrl = "https://private.invalid/output/secret.mp4";
const scenes = (...groups) => groups.flatMap(([status, count]) =>
  Array.from({ length: count }, (_, index) => ({
    status,
    scene_number: index + 1,
    error_provider: privateError,
    error_message: privateError,
    prompt: privatePrompt,
    video_url: privateUrl,
    provider_response: { error: privateError, url: privateUrl },
  })),
);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function checkStatus(input, expectedLabel, failureCount = 0) {
  const before = JSON.stringify(input);
  deepFreeze(input);
  const result = viralProductionStatus(input);
  assert.ok(result && typeof result === "object");
  assert.deepEqual(Object.keys(result).sort(), ["detail", "label"]);
  assert.equal(result.label, expectedLabel);
  assert.equal(typeof result.detail, "string");
  assert.equal(JSON.stringify(input), before, "status display must not mutate the quiz or its scenes");
  const output = `${result.label} ${result.detail}`;
  assert.doesNotMatch(output, /PRIVATE_PROVIDER_ERROR_09|PRIVATE_PROMPT_09|provider\.invalid|private\.invalid|https?:\/\//i);
  assert.doesNotMatch(output, /(?:cobrança|cobranca|pagamento)\s+(?:confirmad[ao]|realizad[ao]|efetuad[ao])|(?:foi|foram)\s+cobrad[ao]s?|(?:envio|pedido)\s+(?:aceito|aceite)|(?:accepted|charged|billed)/i);
  if (failureCount) {
    assert.match(result.detail, new RegExp(`\\b${failureCount}\\b`), "failure detail must state the failure count");
    assert.match(result.detail, /falh/i, "failure detail must identify the failures");
  }
  return result;
}

const productionCases = [
  ["all failed", scenes(["failed", 9]), "Produção bloqueada", 9],
  ["failed and downloaded only", scenes(["failed", 3], ["downloaded", 6]), "Produção bloqueada", 3],
  ["one failed among completed scenes", scenes(["downloaded", 8], ["failed", 1]), "Produção bloqueada", 1],
  ["failed with pending", scenes(["failed", 1], ["pending", 8]), "Produção parcial com falhas", 1],
  ["failed with generating", scenes(["failed", 2], ["generating", 1], ["downloaded", 6]), "Produção parcial com falhas", 2],
  ["failed with submitting", scenes(["failed", 4], ["submitting", 1], ["downloaded", 4]), "Produção parcial com falhas", 4],
  ["failed with every active state", scenes(["failed", 2], ["pending", 2], ["generating", 2], ["submitting", 2], ["downloaded", 1]), "Produção parcial com falhas", 2],
  ["all pending", scenes(["pending", 9]), "Cenas na fila"],
  ["last scene pending", scenes(["downloaded", 8], ["pending", 1]), "Cenas na fila"],
  ["all generating", scenes(["generating", 9]), "Gerando cenas"],
  ["generating with pending and downloaded", scenes(["downloaded", 6], ["pending", 2], ["generating", 1]), "Gerando cenas"],
  ["generating takes precedence over submitting", scenes(["pending", 7], ["submitting", 1], ["generating", 1]), "Gerando cenas"],
  ["all submitting", scenes(["submitting", 9]), "Envio em conferência"],
  ["submitting with pending and downloaded", scenes(["pending", 4], ["downloaded", 4], ["submitting", 1]), "Envio em conferência"],
  ["all nine scenes downloaded", scenes(["downloaded", 9]), "Cenas prontas"],
];

for (const [name, sceneList, label, failures = 0] of productionCases) {
  test(`in production: ${name}`, () => {
    const quiz = { status: "in_production", scenes: sceneList, prompt: privatePrompt, error_provider: privateError };
    const forward = checkStatus(quiz, label, failures);
    const reversed = checkStatus({ ...quiz, scenes: [...sceneList].reverse() }, label, failures);
    assert.equal(reversed.detail, forward.detail, "scene order must not change the summary");
  });
}

const sparseScenes = scenes(["downloaded", 9]);
delete sparseScenes[4];
const malformedCases = [
  ["missing scenes", undefined],
  ["null scenes", null],
  ["non-array scenes", { length: 9 }],
  ["string scenes", "downloaded"],
  ["no scenes", []],
  ["eight downloaded scenes", scenes(["downloaded", 8])],
  ["ten downloaded scenes", scenes(["downloaded", 10])],
  ["eight pending scenes", scenes(["pending", 8])],
  ["eight failed scenes", scenes(["failed", 8])],
  ["sparse scene array", sparseScenes],
  ["fully sparse scene array", Array(9)],
  ["null scene", [...scenes(["downloaded", 8]), null]],
  ["undefined scene", [...scenes(["downloaded", 8]), undefined]],
  ["scene without status", [...scenes(["downloaded", 8]), {}]],
  ["unknown scene state", scenes(["downloaded", 8], ["unknown_state", 1])],
  ["unknown state among failures", scenes(["failed", 8], ["unknown_state", 1])],
  ["unknown state among active scenes", scenes(["generating", 8], ["unknown_state", 1])],
  ["non-string scene state", [...scenes(["pending", 8]), { status: { value: "failed" } }]],
  ["array must not be coerced to a known scene state", [...scenes(["pending", 8]), { status: ["failed"] }]],
];

for (const [name, sceneList] of malformedCases) {
  test(`uncertain input: ${name}`, () => {
    const quiz = { status: "in_production" };
    if (sceneList !== undefined) quiz.scenes = sceneList;
    checkStatus(quiz, "Estado das cenas em conferência");
  });
}

const existingLabels = {
  awaiting_approval: "Aguardando Gestora",
  approved: "Vídeo final pronto",
  published: "Publicado",
  cancelled: "Cancelado",
  future_status: "future_status",
  toString: "toString",
};

for (const [status, label] of Object.entries(existingLabels)) {
  test(`preserves non-production status: ${status}`, () => {
    for (const sceneList of [scenes(["failed", 9]), scenes(["pending", 9]), scenes(["downloaded", 9]), [], null]) {
      const result = checkStatus({ status, scenes: sceneList }, label);
      assert.equal(result.detail, "", "other workflow stages must keep their original empty detail");
    }
  });
}

test("failed and unconfirmed submissions do not imply ongoing processing", () => {
  const result=checkStatus({status:"in_production",scenes:scenes(["failed",8],["submitting",1])},"Produção parcial com falhas",8);
  assert.match(result.detail,/envios sem confirmação/);
  assert.doesNotMatch(result.detail,/na fila ou em processamento/);
});

test("unavailable video provider is explicit for pending and previously queued scripts", () => {
  for(const [status,label] of [['awaiting_approval','Roteiro pronto; vídeo indisponível'],['in_production','Produção de vídeo indisponível']]) {
    const result=checkStatus({status,videoAvailable:false,videoUnavailableReason:'Novos vídeos por IA estão indisponíveis.',scenes:scenes(['pending',9])},label);
    assert.equal(result.detail,'Novos vídeos por IA estão indisponíveis.');
  }
  checkStatus({status:'published',videoAvailable:false,scenes:scenes(['downloaded',9])},'Publicado');
});
