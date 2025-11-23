import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { uploadSchedule } from '../api';

const FileUpload = () => {
  const inputRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const onClickArea = () => inputRef.current && inputRef.current.click();

  const onFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadSchedule(file);
      setResult(res);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
      <div className="text-center">
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Upload Production Feasibility Data</h3>
        <p className="text-sm text-gray-600 mb-6">Upload your Excel file containing production feasibility data</p>

        <div onClick={onClickArea} className="border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-gray-400 transition-colors cursor-pointer">
          <input ref={inputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={onFileChange} />
          <div className="space-y-2">
            <Upload className="mx-auto h-8 w-8 text-gray-400" />
            <div className="text-sm text-gray-600">
              <span className="font-medium text-blue-600 hover:text-blue-500 cursor-pointer">Click to upload</span>
              <span> or drag and drop</span>
            </div>
            <p className="text-xs text-gray-500">Excel files only (.xlsx, .xls)</p>
          </div>
        </div>

        <button disabled={uploading} className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors font-medium">
          {uploading ? 'Processing...' : 'Process & Generate Schedule'}
        </button>

        {error && <div className="mt-4 text-red-600 text-sm">{error}</div>}

        {result && (
          <div className="mt-6 text-left">
            <h4 className="font-medium mb-2">Allocation Result</h4>
            <div className="text-sm text-gray-700">
              <div><strong>Output file:</strong> {result.outputFileName}</div>
              <div className="mt-2"><strong>Weeks:</strong></div>
              <ul className="list-disc ml-6 mt-2">
                {result.weeks && result.weeks.map((w, idx) => (
                  <li key={idx} className="mb-1">
                    <strong>{w.weekColumn}</strong>: SUM={w.SUM}, Count={w.CountOfParts}, actualWorkingDays={w.actualWorkingDays}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4">
              <a href={result.outputPath} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open output file</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
