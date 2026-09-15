"use client";
import { AppShell } from '@creezio/shell-ui/ui';
import { TasksKanbanClient } from '@creezio/tasks/ui';
export default function Tasks(){return <AppShell title="Tâches"><TasksKanbanClient executors={["human"]}/></AppShell>;}
