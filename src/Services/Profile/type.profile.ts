export type ProfileData = {
  id: string;
  username: string;
  fullName?: string;
  biography?: string;
  followerCount?: number;
  followingCount?: number;
  postsCount?: number;
  isPrivate?: boolean;
  isVerified?: boolean;
  isBusinessAccount?: boolean;
  isProfessionalAccount?: boolean;
  categoryName?: string;
  externalUrl?: string;
  profilePicUrl?: string;
  profilePicUrlHd?: string;
  fbid?: string;
  bio_links: string[];
};
export interface RawTimelineEdge {
  node: Record<string, any>;
}

export interface RawTimelineMedia {
  count: number;
  edges: RawTimelineEdge[];
  page_info: { has_next_page: boolean; end_cursor: string | null };
}
export type RawProfileUser = {
  id: string;
  username: string;
  full_name?: string;
  biography?: string;
  edge_followed_by?: { count: number };
  edge_follow?: { count: number };
  is_private?: boolean;
  is_verified?: boolean;
  is_business_account?: boolean;
  is_professional_account?: boolean;
  edge_owner_to_timeline_media?: RawTimelineMedia;
  category_name?: string;
  external_url?: string;
  profile_pic_url?: string;
  profile_pic_url_hd?: string;
  fbid?: string;
  bio_links?: {
    title: string;
    lynx_url: string;
    url: string;
    link_type: string;
  }[];
};
export type ProfileInfoResponse = {
  data?: { user?: RawProfileUser };
};

// User object returned by the PolarisProfilePageContentQuery GraphQL call.
export type RawGraphqlProfileUser = {
  pk?: string;
  id?: string;
  username: string;
  fbid_v2?: string;
  full_name?: string;
  biography?: string;
  follower_count?: number;
  following_count?: number;
  media_count?: number;
  is_private?: boolean;
  is_verified?: boolean;
  is_business?: boolean;
  is_professional_account?: boolean | null;
  category?: string;
  external_url?: string;
  profile_pic_url?: string;
  hd_profile_pic_url_info?: { url?: string };
  bio_links?: { url?: string }[];
};
export type GraphqlProfileResponse = {
  data?: { user?: RawGraphqlProfileUser };
};

// User object embedded in the logged-out profile page HTML, under the
// `xig_user_by_username` key. Instagram mixes flat counts (follower_count) and
// older edge-shaped counts (edge_followed_by.count) across responses, so both
// forms are optional and the mapper falls back from one to the other.
export type RawPageProfileUser = {
  id?: string;
  pk?: string;
  username: string;
  full_name?: string;
  biography?: string;
  follower_count?: number;
  following_count?: number;
  edge_followed_by?: { count: number };
  edge_follow?: { count: number };
  media_count?: number;
  all_media_count?: number | null;
  edge_owner_to_timeline_media?: { count: number };
  is_private?: boolean;
  is_verified?: boolean;
  is_business_account?: boolean;
  is_business?: boolean;
  is_professional_account?: boolean | null;
  category_name?: string;
  category?: string;
  external_url?: string;
  profile_pic_url?: string;
  profile_pic_url_hd?: string;
  hd_profile_pic_url_info?: { url?: string };
  fbid?: string;
  fbid_v2?: string;
  bio_links?: { url?: string }[];
};
