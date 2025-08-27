export const getStatusColor = (status) => {
  switch (status) {
    case 'active': return 'bg-green-100 text-green-800 border-green-200';
    case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'error': return 'bg-red-100 text-red-800 border-red-200';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export const getEfficiencyColor = (efficiency) => {
  if (efficiency >= 90) return 'text-green-600';
  if (efficiency >= 80) return 'text-yellow-600';
  return 'text-red-600';
};
