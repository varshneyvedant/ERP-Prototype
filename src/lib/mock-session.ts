export const getServerSession = async (...args: any[]) => ({
  user: { role: 'owner', id: '1', name: 'owner', username: 'owner' }
});
export const authOptions = {};
