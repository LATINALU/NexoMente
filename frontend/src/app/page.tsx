"use client";

/**
 * Nexo - Equipos de agentes IA.
 * La página solo compone: el estado vive en stores/ y la lógica en features/.
 */

import { useState } from "react";
import { CategorySidebar } from "@/components/CategorySidebar";
import { AppSettings } from "@/components/AppSettings";
import { AgentDetailPanel } from "@/components/AgentDetailPanel";
import { TeamsPanel } from "@/components/TeamsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { Chat } from "@/features/chat/Chat";
import { AppHeader } from "@/features/shell/AppHeader";
import { StoreHydrator } from "@/stores/StoreHydrator";
import { selectApiReady, useWorkspace } from "@/stores/workspace";
import { useSettings } from "@/stores/settings";
import type { Team } from "@/lib/teams";

export default function HomePage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);

  const { selectedAgents, toggleAgent, toggleCategory, setAgents, setProviders } = useWorkspace();
  const apiReady = useWorkspace(selectApiReady);
  const { runOptions, agentInstructions, setRunOptions, setInstruction, mergeInstructions } = useSettings();

  const selectedInstructions = Object.fromEntries(Object.entries(agentInstructions).filter(([id]) => selectedAgents.includes(id)));

  const applyTeam = (team: Team) => {
    setAgents(team.agents);
    setRunOptions({ mode: team.mode, synthesize: team.synthesize, webSearch: team.web_search });
    mergeInstructions(team.instructions);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden relative">
      <StoreHydrator />
      <AppHeader wsConnected={wsConnected} onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        <div className="border-r border-primary/20 flex-shrink-0 overflow-hidden">
          <CategorySidebar
            selectedAgents={selectedAgents}
            onAgentToggle={toggleAgent}
            onSelectCategory={(_categoryId, agentIds) => toggleCategory(agentIds)}
            onClearAll={() => setAgents([])}
            onShowAgentDetails={setDetailAgentId}
            isConnected={apiReady}
          />
        </div>

        <main className="flex-1 overflow-hidden">
          <Chat
            onOpenSettings={() => setSettingsOpen(true)}
            onConnectionChange={setWsConnected}
            sidePanelHeader={
              <TeamsPanel
                current={{
                  agents: selectedAgents, mode: runOptions.mode, synthesize: runOptions.synthesize,
                  web_search: runOptions.webSearch, instructions: selectedInstructions,
                }}
                onApply={applyTeam}
              />
            }
          />
        </main>
      </div>

      <AppSettings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onProvidersChange={setProviders} />

      <CommandPalette
        selectedAgents={selectedAgents}
        onToggleAgent={toggleAgent}
        onApplyTeam={applyTeam}
        onOpenSettings={() => setSettingsOpen(true)}
        onClearAgents={() => setAgents([])}
      />

      {detailAgentId && (
        <AgentDetailPanel
          agentId={detailAgentId}
          isSelected={selectedAgents.includes(detailAgentId)}
          instructions={agentInstructions[detailAgentId]}
          onToggleSelected={toggleAgent}
          onInstructionsChange={setInstruction}
          onClose={() => setDetailAgentId(null)}
        />
      )}
    </div>
  );
}
