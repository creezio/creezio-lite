"use client";
import { AppShell } from '@lite/shell-ui/ui';
import { TasksKanbanClient } from '@lite/tasks/ui';
export default function Tasks(){return <AppShell title="Tâches"><TasksKanbanClient executors={["human"]}/></AppShell>;}
