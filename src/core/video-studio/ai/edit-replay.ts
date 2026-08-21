/**
 * KNOUX-X — VIDEO STUDIO D11 DETERMINISTIC EDIT REPLAY
 *
 * Replay executes a persisted EditPlan against a MultitrackProject WITHOUT
 * invoking any AI model (Amendment 18). The same pure function is used by
 * D10's impact analyzer to simulate a plan before approval — one code path,
 * one truth.
 */

import {
  deleteItems,
  insertItem,
  moveItem,
  parseMultitrackProject,
  splitTimelineItem,
  upsertKeyframe,
} from '../../creative/multitrackProject';
import type { MultitrackProject } from '../../creative/multitrackProject';

import { parseEditPlan } from './edit-plan';

export class EditPlanReplayError extends Error {
  constructor(message: string, readonly operationId: string) {
    super(message);
    this.name = 'EditPlanReplayError';
  }
}

/** Guard: the plan must reference the project revision it was approved against. */
export function assertPlanMatchesProject(plan: { sourceProjectRevision: string }, project: MultitrackProject): void {
  const revision = `${project.id}@${project.updatedAt}@`;
  if (!plan.sourceProjectRevision.startsWith(revision)) {
    throw new EditPlanReplayError('Plan source revision does not match the current project revision.', '');
  }
}

function findItem<T extends MultitrackProject>(project: T, itemId: string) {
  for (const track of project.tracks) {
    const index = track.items.findIndex((entry) => entry.id === itemId);
    if (index >= 0) return { track, index };
  }
  return null;
}

/**
 * Applies an ordered plan to a parse-validated clone of the project.
 * Deterministic: same source + same plan ⇒ same output project (verified
 * by the trailing parseMultitrackProject gate).
 */
export function applyEditPlan(project: MultitrackProject, planValue: unknown): MultitrackProject {
  const plan = parseEditPlan(planValue);
  const next = parseMultitrackProject(project);

  for (const operation of plan.operations) {
    try {
      switch (operation.op) {
        case 'insert-item': {
          const inserted = insertItem(next, operation.item);
          next.tracks = inserted.tracks;
          break;
        }
        case 'move-item': {
          const moved = moveItem(next, operation.itemId, operation.targetTrackId, operation.timelineStart);
          next.tracks = moved.tracks;
          break;
        }
        case 'delete-items': {
          const removed = deleteItems(next, operation.itemIds);
          next.tracks = removed.tracks;
          break;
        }
        case 'split-item': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for split-item.');
          const [left, right] = splitTimelineItem(found.track.items[found.index], operation.timelineTime, operation.rightId);
          found.track.items = found.track.items.flatMap((item) => item.id === operation.itemId ? [left, right] : [item]);
          break;
        }
        case 'trim-item': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for trim-item.');
          found.track.items[found.index].timelineStart = operation.timelineStart;
          found.track.items[found.index].duration = operation.duration;
          found.track.items[found.index].sourceIn = operation.sourceIn;
          found.track.items[found.index].sourceOut = operation.sourceOut;
          break;
        }
        case 'patch-transform': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for patch-transform.');
          found.track.items[found.index].transform = { ...found.track.items[found.index].transform, ...operation.patch };
          break;
        }
        case 'patch-audio': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for patch-audio.');
          found.track.items[found.index].audio = { ...found.track.items[found.index].audio, ...operation.patch };
          break;
        }
        case 'update-text': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for update-text.');
          found.track.items[found.index].text = { ...operation.text };
          break;
        }
        case 'upsert-keyframe': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for upsert-keyframe.');
          found.track.items[found.index] = upsertKeyframe(found.track.items[found.index], operation.keyframe);
          break;
        }
        case 'remove-keyframe': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for remove-keyframe.');
          const keyframeId = operation.keyframeId;
          found.track.items[found.index] = {
            ...found.track.items[found.index],
            keyframes: found.track.items[found.index].keyframes.filter((keyframe) => keyframe.id !== keyframeId),
          };
          break;
        }
        case 'set-transition': {
          const found = findItem(next, operation.itemId);
          if (!found) throw new Error('Item not found for set-transition.');
          const { side, transition } = operation;
          found.track.items[found.index] = {
            ...found.track.items[found.index],
            [side === 'in' ? 'transitionIn' : 'transitionOut']: transition,
          };
          break;
        }
        default:
          throw new Error('Unsupported edit operation.');
      }
    } catch (cause) {
      if (cause instanceof EditPlanReplayError) throw cause;
      throw new EditPlanReplayError(cause instanceof Error ? cause.message : 'Replay failed.', operation.id);
    }
  }

  return parseMultitrackProject(next);
}

export interface ReplaySummary {
  project: MultitrackProject;
  appliedOperationCount: number;
}

/**
 * Deterministic replay from a persisted record: parse → guard revision →
 * apply → validate.
 */
export function replayEditPlan(project: MultitrackProject, planValue: unknown, requireRevisionMatch = true): ReplaySummary {
  const plan = parseEditPlan(planValue);
  if (requireRevisionMatch) assertPlanMatchesProject(plan, project);
  return {
    project: applyEditPlan(project, planValue),
    appliedOperationCount: plan.operations.length,
  };
}