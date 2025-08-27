import { Upload } from 'lucide-react';

const FileUpload = () => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
    <div className="text-center">
      <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-2">Upload Production Feasibility Data</h3>
      <p className="text-sm text-gray-600 mb-6">Upload your Excel file containing production feasibility data</p>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-gray-400 transition-colors cursor-pointer">
        <input type="file" className="hidden" accept=".xlsx,.xls" />
        <div className="space-y-2">
          <Upload className="mx-auto h-8 w-8 text-gray-400" />
          <div className="text-sm text-gray-600">
            <span className="font-medium text-blue-600 hover:text-blue-500 cursor-pointer">Click to upload</span>
            <span> or drag and drop</span>
          </div>
          <p className="text-xs text-gray-500">Excel files only (.xlsx, .xls)</p>
        </div>
      </div>

      <button className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition-colors font-medium">
        Process & Generate Schedule
      </button>
    </div>
  </div>
);

export default FileUpload;
