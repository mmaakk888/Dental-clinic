/** Internal billing identities for casual visitors are not paper-file numbers. */
export function hasPatientFile(patient: {id:string;withoutFile?:boolean}):boolean {
  return patient.withoutFile!==true&&!patient.id.startsWith('unfiled:');
}
export function patientFileLabel(patient:{id:string;withoutFile?:boolean}):string {
  return hasPatientFile(patient)?`ملف #${patient.id}`:'بدون ملف';
}
