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

export const buildStudioAi: AgAiHarnessSetup = ({ api }) =>
  createAiHarness(api, ({ builtIn, tools: harnessTools }) => {
    const delegates = [builtIn.planning, builtIn.data, builtIn.page, builtIn.widget];
    const disputeAgentId = "dispute-explainer";
    return {
      primary: "lead",
      promptStarters: [
        {
          label: "Explain compliant dispute",
          prompt: "Explain dispute PP-D-1001 and cite the available mandate evidence.",
        },
        {
          label: "Draft an overreach reply",
          prompt: "Explain dispute PP-D-1002 and draft a reply for the buyer to review.",
        },
        {
          label: "Compare agent platforms",
          prompt: "Which agent platforms have the most wrong-item disputes in this dashboard?",
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
          maxTurns: 4,
          instructions: () =>
            "Use the read-only dispute tools and cite the case ID. Explain the recommendation from the tool result. Label buyer replies as drafts and never claim any action was taken.",
          tools: disputeTools,
        }),
      ],
    };
  });
