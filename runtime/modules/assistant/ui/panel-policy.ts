/** Shared presentation policy. Widths are CSS pixels, before assistant padding. */
export const ASSISTANT_PANEL_WIDTH_PX = 400;
export const ASSISTANT_MIN_MAIN_WIDTH_PX = 640;
export const ASSISTANT_MOBILE_BREAKPOINT_PX = 768;
export type AssistantPresentation = 'docked' | 'overlay' | 'fullscreen';
export type WorkspaceGeometry = {width:number; sidebarWidth:number};
export function assistantPresentation({viewportWidth,workspaceWidth,sidebarWidth=0,minMainWidth=ASSISTANT_MIN_MAIN_WIDTH_PX}: {
  viewportWidth:number; workspaceWidth:number; sidebarWidth?:number; minMainWidth?:number;
}): AssistantPresentation {
  if (!Number.isFinite(viewportWidth) || viewportWidth < ASSISTANT_MOBILE_BREAKPOINT_PX) return 'fullscreen';
  const threshold=Number.isFinite(minMainWidth)&&minMainWidth>0?minMainWidth:ASSISTANT_MIN_MAIN_WIDTH_PX;
  return workspaceWidth-Math.max(0,sidebarWidth)-ASSISTANT_PANEL_WIDTH_PX>=threshold?'docked':'overlay';
}
