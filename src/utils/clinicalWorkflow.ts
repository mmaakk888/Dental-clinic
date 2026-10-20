import type {Session} from '../types';
export function isTreatmentOngoing(session:Session):boolean {
  return !session.treatmentCompletedAt && (session.visitStatus==='follow_up'||!!session.treatmentStage&&session.treatmentStage!=='single');
}
