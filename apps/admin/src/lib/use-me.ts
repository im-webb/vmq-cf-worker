import { useQuery } from '@tanstack/react-query';
import { api, type Me } from './api';

/** 当前后台会话；React Query 共用 ['me'] 缓存，各页面无需重复请求。 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<Me>('/me')).data,
    retry: false,
    staleTime: 60_000,
  });
}
