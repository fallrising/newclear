package service

import (
	"bytes"
	"context"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// DescribeRepository returns only approved canonical public bytes, never a Reader or local path.
func (service *Service) DescribeRepository(ctx context.Context, principal domain.ActorID, projectID domain.ProjectID, bindingID string) ([]byte, domain.Digest, error) {
	deny := func() ([]byte, domain.Digest, error) {
		return nil, domain.Digest{}, command.NewError(command.CodeNotFound, "repository binding is unavailable", false, nil, nil)
	}
	if principal != service.config.Operator || nilRepositoryDependency(service.config.RepositoryAuthority) {
		return deny()
	}
	if err := service.unit.Within(ctx, func(tx port.Transaction) error {
		admission, ok := tx.(port.AdmissionTransaction)
		if !ok {
			return port.ErrNotFound
		}
		_, err := admission.LoadProject(ctx, projectID)
		return err
	}); err != nil {
		return deny()
	}
	approved, err := service.config.RepositoryAuthority.Lookup(projectID, bindingID)
	if err != nil {
		return deny()
	}
	canonical, digest, err := port.CanonicalRepositoryBinding(approved)
	if err != nil || approved.Binding.ProjectID != projectID || approved.Binding.ID != bindingID || approved.ApprovedBy != principal || digest != approved.Binding.Digest || nilRepositoryDependency(approved.Reader) {
		return deny()
	}
	return bytes.Clone(canonical), digest, nil
}
