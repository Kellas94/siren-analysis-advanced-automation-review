// Describe the CSV options actually emitted by PipelineCompiler, rather than
// guessing policy from the copied file. An omitted token remains omitted.
export function capturedReaderOptions(format, data) {
 if(format!=='csv')return null;
 const options={header:data.header!==false,allVarchar:data.allVarchar!==false,delimiter:data.delimiter||',',allowQuotedNulls:false};
 if(data.nullStr!==undefined){
  if(typeof data.nullStr!=='string')throw Error('CAPTURED_CSV_NULL_TOKEN_TYPE');
  options.nullStr=data.nullStr;
 }
 return options;
}
