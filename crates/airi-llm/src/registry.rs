// SPDX-License-Identifier: GPL-3.0-or-later

//! Data-driven provider registry.
//!
//! Static [`PROVIDER_DEFS`] list mirroring the Vue `defineProvider()` fleet in
//! `packages/stage-ui/src/libs/providers/providers/`. Provider ids match
//! `docs/port-manifest/providers.md` (44 ids) plus the port-native `llama-cpp-local`
//! registry row (45 total). OpenAI-compatible providers are
//! config rows, not new code: [`ProviderKind::OpenAiCompatible`] and
//! [`ProviderKind::LocalServer`] share one client implementation.
//!
//! See `README.md` in this crate for the implemented-vs-stubbed matrix.

use serde::{Deserialize, Serialize};

/// Provider kind — selects the client implementation in `build_client`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    /// OpenAI-compatible `POST {base}/chat/completions` (+ `GET {base}/models`).
    OpenAiCompatible,
    /// Anthropic Messages API (`POST {base}/messages`, `anthropic-version` header).
    Anthropic,
    /// Google Gemini native API (`POST {base}/models/{model}:streamGenerateContent?alt=sse`).
    GoogleGemini,
    /// AWS Bedrock (SigV4-signed; not wired yet).
    AwsBedrock,
    /// Local server (Ollama / LM Studio). OpenAI-compatible wire; may need no API key.
    LocalServer,
}

/// A single credential field rendered by the UI and consumed by [`crate::ProviderConfig`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CredentialField {
    /// Key in [`crate::ProviderConfig`] (`api_key`, `base_url`, `model`, ...) or a provider-specific extra.
    pub key: &'static str,
    /// Human-readable label.
    pub label: &'static str,
    /// Whether the value is a secret (never log fully).
    pub secret: bool,
    /// Whether the field must be set before the client can be used.
    pub required: bool,
    /// Optional placeholder/hint.
    pub placeholder: Option<&'static str>,
}

/// Typed description of the credentials a provider needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CredentialSchema {
    /// Fields, in display order.
    pub fields: &'static [CredentialField],
}

const fn field(
    key: &'static str,
    label: &'static str,
    secret: bool,
    required: bool,
    placeholder: Option<&'static str>,
) -> CredentialField {
    CredentialField {
        key,
        label,
        secret,
        required,
        placeholder,
    }
}

const API_KEY_REQUIRED: CredentialField = field("api_key", "API Key", true, true, Some("sk-..."));
const API_KEY_OPTIONAL: CredentialField = field("api_key", "API Key", true, false, Some("sk-..."));
const BASE_URL_OPTIONAL: CredentialField = field("base_url", "Base URL", false, false, None);
const BASE_URL_REQUIRED: CredentialField = field("base_url", "Base URL", false, true, None);
const MODEL_REQUIRED: CredentialField = field("model", "Model", false, true, None);

const OPENAI_STANDARD: &[CredentialField] = &[API_KEY_REQUIRED, BASE_URL_OPTIONAL, MODEL_REQUIRED];
const OPENAI_COMPATIBLE: &[CredentialField] =
    &[API_KEY_REQUIRED, BASE_URL_REQUIRED, MODEL_REQUIRED];
const OLLAMA_LOCAL: &[CredentialField] = &[BASE_URL_OPTIONAL, MODEL_REQUIRED];
const ANTHROPIC_FIELDS: &[CredentialField] = &[API_KEY_REQUIRED, BASE_URL_OPTIONAL, MODEL_REQUIRED];
const GEMINI_FIELDS: &[CredentialField] = &[API_KEY_REQUIRED, BASE_URL_OPTIONAL, MODEL_REQUIRED];
const BEDROCK_FIELDS: &[CredentialField] = &[
    field("region", "AWS Region", false, true, Some("us-east-1")),
    field("aws_access_key_id", "AWS Access Key ID", true, true, None),
    field(
        "aws_secret_access_key",
        "AWS Secret Access Key",
        true,
        true,
        None,
    ),
    MODEL_REQUIRED,
];
const CLOUDFLARE_FIELDS: &[CredentialField] = &[
    API_KEY_REQUIRED,
    field("account_id", "Cloudflare Account ID", false, true, None),
    BASE_URL_OPTIONAL,
    MODEL_REQUIRED,
];
const AZURE_FIELDS: &[CredentialField] = &[
    field("api_key", "API Key", true, true, None),
    field(
        "base_url",
        "Base URL (deployment-scoped)",
        false,
        true,
        Some("https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>"),
    ),
    MODEL_REQUIRED,
];
const POLLINATIONS_FIELDS: &[CredentialField] =
    &[API_KEY_OPTIONAL, BASE_URL_OPTIONAL, MODEL_REQUIRED];
const LOCAL_ENGINE_FIELDS: &[CredentialField] = &[];
const TYPESAFE_FIELDS: &[CredentialField] = &[API_KEY_REQUIRED, BASE_URL_OPTIONAL, MODEL_REQUIRED];

impl CredentialSchema {
    /// Standard hosted OpenAI-compatible credential set: `api_key` required,
    /// `base_url` optional override, `model` required.
    pub const fn openai_standard() -> Self {
        Self {
            fields: OPENAI_STANDARD,
        }
    }

    /// Generic "OpenAI Compatible" entry: both `api_key` and `base_url` required.
    pub const fn openai_compatible() -> Self {
        Self {
            fields: OPENAI_COMPATIBLE,
        }
    }

    /// Local server (Ollama / LM Studio): no API key, optional `base_url` override.
    pub const fn ollama_local() -> Self {
        Self {
            fields: OLLAMA_LOCAL,
        }
    }

    /// Anthropic Messages API key.
    pub const fn anthropic() -> Self {
        Self {
            fields: ANTHROPIC_FIELDS,
        }
    }

    /// Google AI Studio API key (sent via `x-goog-api-key` header, never the URL).
    pub const fn gemini() -> Self {
        Self {
            fields: GEMINI_FIELDS,
        }
    }

    /// AWS Bedrock credentials (SigV4 not wired yet — see [`crate::build_client`]).
    pub const fn bedrock() -> Self {
        Self {
            fields: BEDROCK_FIELDS,
        }
    }

    /// Cloudflare Workers AI: token plus account id (endpoint is account-scoped).
    pub const fn cloudflare() -> Self {
        Self {
            fields: CLOUDFLARE_FIELDS,
        }
    }

    /// Azure OpenAI / Azure AI Foundry: `api_key` plus deployment-scoped `base_url`.
    pub const fn azure() -> Self {
        Self {
            fields: AZURE_FIELDS,
        }
    }

    /// Pollinations: keyless by default; `api_key` optional for the paid tier.
    pub const fn pollinations() -> Self {
        Self {
            fields: POLLINATIONS_FIELDS,
        }
    }

    /// On-device engine with no remote credential surface (Laya / OpenJev).
    pub const fn local_engine() -> Self {
        Self {
            fields: LOCAL_ENGINE_FIELDS,
        }
    }

    /// TypeSafe AI (System-1 decision engine; not a chat provider).
    pub const fn typesafe() -> Self {
        Self {
            fields: TYPESAFE_FIELDS,
        }
    }

    /// `true` when the schema requires an API key.
    pub fn requires_api_key(&self) -> bool {
        self.fields.iter().any(|f| f.key == "api_key" && f.required)
    }

    /// Look up a field by key.
    pub fn field(&self, key: &str) -> Option<&'static CredentialField> {
        self.fields.iter().find(|f| f.key == key)
    }
}

/// Capability/intent flags for a provider.
///
/// `vision`/multimodal support is deliberately *not* declared: it is a
/// per-model property, not per-provider. `chat: false` marks registry rows
/// that are not chat providers at all (System-1 decision engine) or whose
/// on-device engines are not wired yet; `build_client` maps those to an
/// [`crate::LlmError::UnsupportedProvider`] stub instead of a fake client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CompatFlags {
    /// Provider can serve chat completions via a wired client today.
    pub chat: bool,
    /// Streaming (SSE) responses are supported.
    pub streaming: bool,
    /// The wire accepts a `tools` parameter.
    pub tools: bool,
    /// `GET {base}/models` (or equivalent) list endpoint exists.
    pub models_endpoint: bool,
    /// Free-form note surfaced in docs/UI (quirks, caveats).
    pub note: Option<&'static str>,
}

const OPENAI_WIRE: CompatFlags = CompatFlags {
    chat: true,
    streaming: true,
    tools: true,
    models_endpoint: true,
    note: None,
};

const fn wire(note: Option<&'static str>) -> CompatFlags {
    CompatFlags {
        note,
        ..OPENAI_WIRE
    }
}

const NO_CHAT: CompatFlags = CompatFlags {
    chat: false,
    streaming: false,
    tools: false,
    models_endpoint: false,
    note: None,
};

const fn no_chat(note: &'static str) -> CompatFlags {
    CompatFlags {
        note: Some(note),
        ..NO_CHAT
    }
}

/// Wire flags for the native in-process llama.cpp provider.
///
/// Not served by [`crate::build_client`] (which would produce a
/// base-url-less OpenAI-compatible client pointing nowhere); `airi-core`'s
/// `resolve_provider` intercepts this id before the registry fallback and
/// builds `airi-local-llm::LlamaChatProvider` instead. `tools` and
/// `models_endpoint` are false — the native bridge does neither today.
const LOCAL_CPP_LOCAL: CompatFlags = CompatFlags {
    chat: true,
    streaming: true,
    tools: false,
    models_endpoint: false,
    note: Some("native in-process GGUF inference via llama-cpp-2; no HTTP server; model path from AIRI_QT_LLAMA_MODEL or settings/local-llm"),
};

/// Provider descriptor (static registry row).
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ProviderDef {
    /// Id used in configs/stores.
    pub id: &'static str,
    /// Human-readable label.
    pub label: &'static str,
    /// Client implementation selection.
    pub kind: ProviderKind,
    /// Default base URL, if any.
    pub base_url: Option<&'static str>,
    /// Credential schema for the UI/config boundary.
    pub credential: CredentialSchema,
    /// Capability/intent flags.
    pub compat: CompatFlags,
}

const fn def(
    id: &'static str,
    label: &'static str,
    kind: ProviderKind,
    base_url: Option<&'static str>,
    credential: CredentialSchema,
    compat: CompatFlags,
) -> ProviderDef {
    ProviderDef {
        id,
        label,
        kind,
        base_url,
        credential,
        compat,
    }
}

const ARK_NOTE: Option<&'static str> = Some(
    "Volcengine Ark wire is OpenAI-compatible (createOpenAI in stage-ui); manifest's OpenAI-compatible:no reflects custom validators, not the wire protocol",
);

/// Static registry of the 44 provider ids from `docs/port-manifest/providers.md` plus
/// the port-native `llama-cpp-local` row (45 total).
pub static PROVIDER_DEFS: &[ProviderDef] = &[
    def("302-ai", "302.AI", ProviderKind::OpenAiCompatible, Some("https://api.302.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("aihubmix", "AIHubMix", ProviderKind::OpenAiCompatible, Some("https://aihubmix.com/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("alibaba-cloud", "Alibaba Cloud", ProviderKind::OpenAiCompatible, None, CredentialSchema::openai_standard(), wire(Some("workspace-scoped compatible-mode endpoint; set base_url to your DashScope/Bailian workspace URL"))),
    def("amazon-bedrock", "Amazon Bedrock", ProviderKind::AwsBedrock, None, CredentialSchema::bedrock(), no_chat("SigV4-signed Converse/InvokeModel APIs; arrives in a later phase — do not fake with OpenAI wire")),
    def("anthropic", "Anthropic", ProviderKind::Anthropic, Some("https://api.anthropic.com/v1"), CredentialSchema::anthropic(), CompatFlags { note: None, ..OPENAI_WIRE }),
    def("atlascloud", "Atlas Cloud", ProviderKind::OpenAiCompatible, Some("https://api.atlascloud.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("azure-ai-foundry", "Azure AI Foundry", ProviderKind::OpenAiCompatible, None, CredentialSchema::azure(), wire(Some("deployment-scoped base_url; ?api-version= passthrough not supported yet — front with openai-compatible proxy if needed"))),
    def("azure-openai", "Azure OpenAI", ProviderKind::OpenAiCompatible, None, CredentialSchema::azure(), wire(Some("deployment-scoped base_url; ?api-version= passthrough not supported yet — front with openai-compatible proxy if needed"))),
    def("byteplus", "BytePlus", ProviderKind::OpenAiCompatible, Some("https://ark.ap-southeast.bytepluses.com/api/v3"), CredentialSchema::openai_standard(), wire(ARK_NOTE)),
    def("byteplus-coding-plan", "BytePlus Coding Plan", ProviderKind::OpenAiCompatible, Some("https://ark.ap-southeast.bytepluses.com/api/coding/v3"), CredentialSchema::openai_standard(), wire(ARK_NOTE)),
    def("cerebras-ai", "Cerebras", ProviderKind::OpenAiCompatible, Some("https://api.cerebras.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("cloudflare-workers-ai", "Cloudflare Workers AI", ProviderKind::OpenAiCompatible, None, CredentialSchema::cloudflare(), wire(Some("OpenAI-compatible endpoint lives at /client/v4/accounts/{account_id}/ai/v1; set base_url accordingly"))),
    def("comet-api", "CometAPI", ProviderKind::OpenAiCompatible, Some("https://api.cometapi.com/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("deepseek", "DeepSeek", ProviderKind::OpenAiCompatible, Some("https://api.deepseek.com"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("featherless-ai", "Featherless.ai", ProviderKind::OpenAiCompatible, Some("https://api.featherless.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("fireworks-ai", "Fireworks.ai", ProviderKind::OpenAiCompatible, Some("https://api.fireworks.ai/inference/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("google-generative-ai", "Google Gemini", ProviderKind::GoogleGemini, Some("https://generativelanguage.googleapis.com/v1beta"), CredentialSchema::gemini(), CompatFlags { note: None, ..OPENAI_WIRE }),
    def("groq", "Groq", ProviderKind::OpenAiCompatible, Some("https://api.groq.com/openai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("kilo", "Kilo", ProviderKind::OpenAiCompatible, Some("https://api.kilo.ai/api/gateway/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("laya-local", "Local Laya (On-Device)", ProviderKind::LocalServer, None, CredentialSchema::local_engine(), no_chat("on-device ONNX engine; lands in a later phase")),
    def("llama-cpp-local", "Llama.cpp (Local GGUF)", ProviderKind::LocalServer, None, CredentialSchema::local_engine(), LOCAL_CPP_LOCAL),
    def("lm-studio", "LM Studio", ProviderKind::LocalServer, Some("http://localhost:1234/v1"), CredentialSchema::ollama_local(), wire(Some("local; no API key required"))),
    def("mimo", "MiMo", ProviderKind::OpenAiCompatible, Some("https://api.xiaomimimo.com/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("minimax", "MiniMax", ProviderKind::OpenAiCompatible, Some("https://api.minimax.io/v1"), CredentialSchema::openai_standard(), wire(Some("international endpoint; for the CN endpoint set base_url to https://api.minimaxi.com/v1"))),
    def("mistral-ai", "Mistral", ProviderKind::OpenAiCompatible, Some("https://api.mistral.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("modelscope", "ModelScope", ProviderKind::OpenAiCompatible, Some("https://api-inference.modelscope.cn/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("moonshot-ai", "Moonshot AI", ProviderKind::OpenAiCompatible, Some("https://api.moonshot.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("n1n", "n1n", ProviderKind::OpenAiCompatible, Some("https://api.n1n.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("novita-ai", "Novita", ProviderKind::OpenAiCompatible, Some("https://api.novita.ai/openai"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("nvidia", "NVIDIA NIM", ProviderKind::OpenAiCompatible, Some("https://integrate.api.nvidia.com/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("ollama", "Ollama", ProviderKind::LocalServer, Some("http://localhost:11434/v1"), CredentialSchema::ollama_local(), wire(Some("local; no API key required"))),
    def("openai", "OpenAI", ProviderKind::OpenAiCompatible, Some("https://api.openai.com/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("openai-compatible", "OpenAI Compatible", ProviderKind::OpenAiCompatible, None, CredentialSchema::openai_compatible(), OPENAI_WIRE),
    def("opencode-go", "OpenCode Go", ProviderKind::OpenAiCompatible, Some("https://opencode.ai/zen/go/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("openjev-local", "OpenJev (On-Device)", ProviderKind::LocalServer, None, CredentialSchema::local_engine(), no_chat("on-device ModernBERT decision engine; lands in a later phase")),
    def("openpaths", "OpenPaths", ProviderKind::OpenAiCompatible, Some("https://openpaths.io/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("openrouter-ai", "OpenRouter", ProviderKind::OpenAiCompatible, Some("https://openrouter.ai/api/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("opper", "Opper", ProviderKind::OpenAiCompatible, Some("https://api.opper.ai/v3/compat"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("perplexity-ai", "Perplexity", ProviderKind::OpenAiCompatible, Some("https://api.perplexity.ai"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("pollinations", "Pollinations AI", ProviderKind::OpenAiCompatible, Some("https://text.pollinations.ai/openai"), CredentialSchema::pollinations(), wire(Some("keyless by default; api_key optional for the paid tier"))),
    def("together-ai", "Together.ai", ProviderKind::OpenAiCompatible, Some("https://api.together.xyz/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("typesafe-ai", "TypeSafe AI (Jev)", ProviderKind::OpenAiCompatible, Some("https://api.typesafe.ai/v1/systemone"), CredentialSchema::typesafe(), no_chat("System-1 cognitive decision engine, not a chat provider")),
    def("volcengine-coding-plan", "Volcengine Coding Plan", ProviderKind::OpenAiCompatible, Some("https://ark.cn-beijing.volces.com/api/coding/v3"), CredentialSchema::openai_standard(), wire(ARK_NOTE)),
    def("xai", "xAI", ProviderKind::OpenAiCompatible, Some("https://api.x.ai/v1"), CredentialSchema::openai_standard(), OPENAI_WIRE),
    def("zai", "Z.ai", ProviderKind::OpenAiCompatible, Some("https://api.z.ai/api/paas/v4"), CredentialSchema::openai_standard(), OPENAI_WIRE),
];

/// Provider stored config (typed; secrets are opaque strings).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderConfig {
    /// API key or token.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// Base URL override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Model default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Extra JSON options retained at persistence boundary only.
    #[serde(default)]
    pub extra_json: serde_json::Map<String, serde_json::Value>,
}

impl ProviderConfig {
    /// Look up a raw extra field (e.g. `account_id`, `region`) from `extra_json`.
    pub fn extra_str<'a>(&'a self, key: &str) -> Option<&'a str> {
        self.extra_json.get(key).and_then(|v| v.as_str())
    }
}

/// Typed registry view over [`PROVIDER_DEFS`].
#[derive(Debug, Clone, Copy, Default)]
pub struct ProviderRegistry;

impl ProviderRegistry {
    /// Build a registry (stateless; the def list is static).
    pub fn new() -> Self {
        Self
    }

    /// All provider defs.
    pub fn all(&self) -> &'static [ProviderDef] {
        PROVIDER_DEFS
    }

    /// Number of registered providers.
    pub fn len(&self) -> usize {
        PROVIDER_DEFS.len()
    }

    /// Whether the registry is empty (never, in practice).
    pub fn is_empty(&self) -> bool {
        PROVIDER_DEFS.is_empty()
    }

    /// Lookup by id.
    pub fn get(&self, id: &str) -> Option<&'static ProviderDef> {
        PROVIDER_DEFS.iter().find(|d| d.id == id)
    }

    /// All registered provider ids.
    pub fn ids(&self) -> impl Iterator<Item = &'static str> + '_ {
        PROVIDER_DEFS.iter().map(|d| d.id)
    }
}
