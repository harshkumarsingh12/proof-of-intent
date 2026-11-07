import {
  createAiHarness,
  directLlmRunner,
  type AgAiEvent,
  type AgAiHarnessSetup,
  type AgAiTool,
  type AgLlmAdapter,
  type AgLlmResponse,
} from "ag-studio";

export const tools = [
  {
    name: "explain_dispute",
    readOnly: true,
    description: "Read the policy recommendation and failed checks for a dispute.",
  },
  {
    name: "draft_buyer_message",
    readOnly: true,
    description: "Read a suggested buyer reply for operator review.",
  },
  {
    name: "list_disputes",
    readOnly: true,
    description: "List dispute IDs and current statuses from PayPal.",
  },
  {
    name: "get_dispute",
    readOnly: true,
    description: "Read a dispute's current status, reason and stage from PayPal.",
  },
] as const;

async function requestStudio(body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/ai/studio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data?.message === "string" ? data.message : "Studio is unavailable");
  return data;
}

function disputeTools(): AgAiTool[] {
  return tools.map(({ name, description }) => {
    const needsId = name !== "list_disputes";
    return {
      name,
      description,
      kind: "client",
      schema: () => ({
        name,
        description,
        parameters: {
          type: "object",
          properties: needsId ? { disputeId: { type: "string" } } : {},
          required: needsId ? ["disputeId"] : [],
          additionalProperties: false,
        },
      }),
      async execute({ args }, ctx) {
        if (needsId && (typeof args.disputeId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(args.disputeId))) {
          return ctx.error("Enter a valid dispute ID.");
        }
        try {
          const data = await requestStudio(
            { kind: "tool", tool: name, ...(needsId ? { disputeId: args.disputeId } : {}) },
            ctx.signal,
          );
          return ctx.success(JSON.stringify(data));
        } catch (error) {
          return ctx.error(error instanceof Error ? error.message : "Dispute lookup failed");
        }
      },
    };
  });
}

interface StudioAnswer {
  text: string;
  tool: { name: string; arguments: string } | null;
}

const adapter: AgLlmAdapter = {
  executeTurn(request, options) {
    const history = request.input
      .flatMap((item) => {
        if (item.type === "function_call_output") return [{ role: "tool", text: item.output.slice(0, 6000) }];
        // Show the model its own earlier calls. Without them it can't tell it already asked for the schema and
        // asks again until the turn limit ("This took more steps than allowed").
        if (item.type === "function_call")
          return [{ role: "assistant", text: `Called ${item.name} with ${item.arguments}`.slice(0, 1000) }];
        if (item.type !== "message") return [];
        return [
          {
            role: item.role === "assistant" ? "assistant" : "user",
            text: item.content
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n")
              .slice(0, 6000),
          },
        ];
      })
      .slice(-16);
    const answer = requestStudio(
      {
        kind: "turn",
        instructions: request.instructions?.slice(0, 16000) ?? "",
        history,
        tools:
          request.tools?.map(({ name, description, parameters }) => ({ name, description, parameters })) ??
          [],
        toolChoice: request.toolChoice,
        format: request.responseFormat.type === "json" ? request.responseFormat.schema : undefined,
      },
      options?.signal,
    ) as Promise<StudioAnswer>;
    const id = crypto.randomUUID();
    const complete: Promise<AgLlmResponse> = answer.then(({ text, tool }) => ({
      id,
      createdAt: Date.now(),
      status: "completed",
      output: tool
        ? [
            {
              id,
              kind: "output",
              type: "function_call",
              callId: id,
              name: tool.name,
              arguments: tool.arguments,
              status: "completed",
            },
          ]
        : [
            {
              id,
              kind: "output",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "text", text, annotations: [] }],
            },
          ],
    }));
    void complete.catch(() => {});
    return {
      complete,
      stream: {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgAiEvent> {
          const { text, tool } = await answer;
          if (tool) {
            yield { type: "TOOL_CALL_START", toolCallId: id, toolCallName: tool.name };
            yield { type: "TOOL_CALL_ARGS", toolCallId: id, delta: tool.arguments };
            yield { type: "TOOL_CALL_END", toolCallId: id };
          } else {
            yield { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" };
            yield { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text };
            yield { type: "TEXT_MESSAGE_END", messageId: id };
          }
        },
      },
    };
  },
};

/** Dispute ids the starter prompts point at, so they work on whatever data the page is showing. */
export interface StudioExamples {
  compliant?: string;
  other?: string;
}

/** Real ids from the disputes the page loaded: the first compliant one, and the first that isn't. */
export function studioExamples(disputes: { id: string; disputeClass: string }[]): StudioExamples {
  return {
    compliant: disputes.find((d) => d.disputeClass === "MANDATE_COMPLIANT")?.id,
    other: disputes.find((d) => d.disputeClass !== "MANDATE_COMPLIANT")?.id ?? disputes[0]?.id,
  };
}

export const createStudioAi =
  (examples: StudioExamples = {}): AgAiHarnessSetup =>
  ({ api }) =>
    createAiHarness(api, ({ builtIn, tools: harnessTools }) => {
      const delegates = [builtIn.planning, builtIn.data, builtIn.page, builtIn.widget];
      const disputeAgentId = "dispute-explainer";
      return {
        // The chat opens on DisputeExplainer. The built-in orchestrator is built for assembling dashboards, its prompt
        // starts by inspecting the page, and with the live model it never got as far as a dispute (it looped on
        // view_schema/view_report/view_page, and its nested delegate_to arguments failed validation). Its flat
        // {disputeId} tools and short prompt work; the other agents stay registered.
        primary: disputeAgentId,
        promptStarters: [
          {
            label: "Explain a defended dispute",
            prompt: `Explain dispute ${examples.compliant ?? "PP-D-1001"} and cite the available mandate evidence.`,
          },
          {
            label: "Draft a buyer reply",
            prompt: `Explain dispute ${examples.other ?? "PP-D-1002"} and draft a reply for the buyer to review.`,
          },
          {
            label: "What needs my attention?",
            prompt: "List the disputes and tell me which ones are waiting for my response.",
          },
        ],
        agents: [
          directLlmRunner({
            ...builtIn.lead,
            adapter,
            maxTurns: 4,
            instructions: (ctx, params) =>
              `${builtIn.lead.instructions?.(ctx, params) ?? ""}\nDelegate dispute explanations and buyer drafts to DisputeExplainer.`,
            tools: (ctx, params) => [
              ...(builtIn.lead.tools?.(ctx, params) ?? []).filter((tool) => tool.name !== "delegate_to"),
              harnessTools.delegateTo([...delegates.map((agent) => agent.id), disputeAgentId]),
            ],
          }),
          ...delegates.map((agent) => directLlmRunner({ ...agent, adapter, maxTurns: 4 })),
          directLlmRunner({
            id: disputeAgentId,
            name: "DisputeExplainer",
            description: "Explains policy decisions and drafts buyer replies for a dispute ID.",
            adapter,
            maxTurns: 6,
            instructions: () =>
              [
                "You help a merchant's operator understand disputes. Use the read-only dispute tools yourself; never ask the user to run a tool.",
                "When the user names a dispute id, call explain_dispute with it right away. Call draft_buyer_message only when the user asks for a reply or a message to the buyer. To see which disputes exist or which are waiting, call list_disputes. Once you have the result you need, answer; do not call more tools.",
                "Meanings: MANDATE_COMPLIANT means the cart met every limit the shopper signed, so the merchant defends with evidence (PROVIDE_EVIDENCE). AGENT_OVERREACH means the agent bought outside the signed limits, so the merchant accepts the buyer's claim and refunds (ACCEPT_CLAIM). INTENT_MISREAD means the item was related but not what the shopper meant (offer or accept). NO_MANDATE means there is no signed record, so standard evidence applies. Never say a claim was rejected unless a tool says so. Write codes and ids such as `AGENT_OVERREACH` and `PP-D-1002` in backticks, because the chat renders markdown and would swallow the underscores.",
                "Then answer in a few plain sentences: the class and recommended action, the broken limits, and the case ID. When the user asked for a reply or message, quote the draft text from draft_buyer_message in full and label it a draft. Never claim any action was taken.",
              ].join("\n"),
            tools: disputeTools,
          }),
        ],
      };
    });

/** The harness with the built-in example ids; the page uses `createStudioAi` with real ones. */
export const buildStudioAi: AgAiHarnessSetup = createStudioAi();
